import type { PrismaClient, Plant, BioReading } from "@prisma/client";
import { BIO_CONFIG } from "./config";
import type { BioSummary } from "./types";

// ---- petits utilitaires numériques -----------------------------------------

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Amplitude de référence d'une fenêtre: RMS brut, ou RMS µV si le gain est connu. */
function rmsOf(reading: Pick<BioReading, "rmsRaw" | "rmsUv">): number | null {
  if (typeof reading.rmsRaw === "number") return reading.rmsRaw;
  if (typeof reading.rmsUv === "number") return reading.rmsUv;
  return null;
}

function roundToMinute(date: Date): Date {
  return new Date(Math.round(date.getTime() / 60000) * 60000);
}

// ---- rattachement de la plante ---------------------------------------------

/**
 * Le Pico bioélectrique se rattache automatiquement à la plante du Pico
 * environnemental le plus récemment actif. À défaut (aucun device env), il
 * récupère une plante existante, sinon il possède sa propre plante.
 */
export async function resolveBioPlant(
  prisma: PrismaClient,
  bioDevice: { id: string }
): Promise<Plant> {
  const envPlant = await prisma.plant.findFirst({
    where: { device: { kind: { not: "bioelectric" } } },
    orderBy: [{ device: { lastSeen: "desc" } }, { updatedAt: "desc" }],
  });
  if (envPlant) return envPlant;

  const anyPlant = await prisma.plant.findFirst({ orderBy: { updatedAt: "desc" } });
  if (anyPlant) return anyPlant;

  return prisma.plant.create({
    data: {
      name: "Plante bioélectrique",
      species: "A definir",
      location: "Maison",
      deviceId: bioDevice.id,
    },
  });
}

// ---- indice d'activité ------------------------------------------------------

/**
 * Médiane RMS des dernières fenêtres bio de la plante: sert de baseline pour
 * normaliser l'activité (gain inconnu => mesure relative à la plante elle-même).
 */
export async function recentBaselineRms(
  prisma: PrismaClient,
  plantId: string
): Promise<number | null> {
  const recent = await prisma.bioReading.findMany({
    where: { plantId },
    orderBy: { recordedAt: "desc" },
    take: BIO_CONFIG.activityBaselineCount,
    select: { rmsRaw: true, rmsUv: true },
  });
  const rms = recent.map(rmsOf).filter((v): v is number => v != null && v > 0);
  return median(rms);
}

/** Indice d'activité 0-1, relatif à la baseline (1 = activitySaturation×baseline). */
export function computeActivityIndex(rms: number | null, baselineRms: number | null): number | null {
  if (rms == null) return null;
  if (!baselineRms || baselineRms <= 0) return null;
  const ratio = rms / baselineRms;
  return clamp01(ratio / BIO_CONFIG.activitySaturationFactor);
}

// ---- détection d'évènements d'arrosage --------------------------------------

export type WateringEvent = { at: Date; rise: number };

/**
 * Détecte les arrosages dans une série de mesures environnementales (ordre
 * chronologique croissant): un saut d'humidité du sol >= seuil sur la fenêtre.
 * Les évènements rapprochés (< responseWindowMin) sont fusionnés.
 */
export function detectWateringEvents(
  readings: { recordedAt: Date; soilMoisturePct: number | null }[]
): WateringEvent[] {
  const pts = readings
    .filter((r) => r.soilMoisturePct != null)
    .map((r) => ({ t: r.recordedAt.getTime(), v: r.soilMoisturePct as number }))
    .sort((a, b) => a.t - b.t);

  const windowMs = BIO_CONFIG.wateringWindowMin * 60000;
  const mergeMs = BIO_CONFIG.responseWindowMin * 60000;
  const events: WateringEvent[] = [];

  for (let i = 1; i < pts.length; i++) {
    let j = i - 1;
    while (j > 0 && pts[i].t - pts[j - 1].t <= windowMs) j--;
    const rise = pts[i].v - pts[j].v;
    if (rise < BIO_CONFIG.wateringMoistureJumpPct) continue;
    const at = new Date(pts[i].t);
    const last = events[events.length - 1];
    if (last && at.getTime() - last.at.getTime() < mergeMs) {
      // même arrosage: on garde le saut le plus marqué.
      if (rise > last.rise) events[events.length - 1] = { at, rise };
    } else {
      events.push({ at, rise });
    }
  }
  return events;
}

// ---- détection de réaction --------------------------------------------------

export type DetectResponsesOptions = { sinceHours: number };

/**
 * Pour chaque arrosage détecté sur la période, compare l'activité bio d'une
 * fenêtre baseline (avant) à celle d'une fenêtre réponse (après) et décide si
 * la plante a réagi. Upsert idempotent dans BioResponseEvent.
 */
export async function detectResponses(
  prisma: PrismaClient,
  plantId: string,
  opts: DetectResponsesOptions
): Promise<number> {
  const since = new Date(Date.now() - opts.sinceHours * 3_600_000);

  const envReadings = await prisma.reading.findMany({
    where: { plantId, recordedAt: { gte: since }, soilMoisturePct: { not: null } },
    orderBy: { recordedAt: "asc" },
    select: { recordedAt: true, soilMoisturePct: true },
  });
  const events = detectWateringEvents(envReadings);
  if (events.length === 0) return 0;

  const baselineMs = BIO_CONFIG.baselineWindowMin * 60000;
  const responseMs = BIO_CONFIG.responseWindowMin * 60000;

  const bio = await prisma.bioReading.findMany({
    where: { plantId, recordedAt: { gte: new Date(since.getTime() - baselineMs) } },
    orderBy: { recordedAt: "asc" },
    select: { recordedAt: true, rmsRaw: true, rmsUv: true, qualityFlag: true },
  });
  if (bio.length === 0) return 0;

  let upserts = 0;
  for (const ev of events) {
    const t = ev.at.getTime();
    const baseWin = bio.filter(
      (b) => b.recordedAt.getTime() >= t - baselineMs && b.recordedAt.getTime() <= t && rmsOf(b) != null
    );
    const respWin = bio.filter(
      (b) => b.recordedAt.getTime() > t && b.recordedAt.getTime() <= t + responseMs && rmsOf(b) != null
    );
    if (baseWin.length < BIO_CONFIG.minSamplesPerWindow || respWin.length < BIO_CONFIG.minSamplesPerWindow) {
      continue;
    }

    const baselineRms = median(baseWin.map((b) => rmsOf(b) as number)) ?? 0;
    const responseRms = mean(respWin.map((b) => rmsOf(b) as number)) ?? 0;
    if (baselineRms <= 0) continue;

    const responseRatio = responseRms / baselineRms;

    let peak = respWin[0];
    for (const b of respWin) if ((rmsOf(b) as number) > (rmsOf(peak) as number)) peak = b;
    const latencyMin = (peak.recordedAt.getTime() - t) / 60000;

    const all = [...baseWin, ...respWin];
    const qualityOkRatio = all.filter((b) => b.qualityFlag === "ok").length / all.length;
    const reacted = responseRatio >= BIO_CONFIG.reactionRatioThreshold && qualityOkRatio >= 0.5;
    const confidence = clamp01(
      Math.min(1, all.length / 12) * Math.max(0.2, qualityOkRatio) * Math.min(1, Math.abs(responseRatio - 1))
    );

    const eventAt = roundToMinute(ev.at);
    const detail = JSON.stringify({
      moistureRise: Math.round(ev.rise * 10) / 10,
      baselineSamples: baseWin.length,
      responseSamples: respWin.length,
      qualityOkRatio: Math.round(qualityOkRatio * 100) / 100,
    });
    const data = {
      baselineRms,
      responseRms,
      responseRatio,
      latencyMin,
      reacted,
      confidence,
      detail,
    };
    await prisma.bioResponseEvent.upsert({
      where: { plantId_eventType_eventAt: { plantId, eventType: "watering", eventAt } },
      create: { plantId, eventType: "watering", eventAt, ...data },
      update: data,
    });
    upserts++;
  }
  return upserts;
}

// ---- résumé pour le LLM / l'UI ---------------------------------------------

/**
 * Résumé de l'activité bioélectrique et des réactions récentes de la plante.
 * Renvoie hasDevice=false (texte vide) quand aucune mesure bio n'existe, pour
 * laisser les plantes sans Pico bio totalement inchangées en aval.
 */
export async function summarizeBioForAgent(
  prisma: PrismaClient,
  plantId: string
): Promise<BioSummary> {
  const dayAgo = new Date(Date.now() - 24 * 3_600_000);

  const [recent, latest, responses, total] = await Promise.all([
    prisma.bioReading.findMany({
      where: { plantId, recordedAt: { gte: dayAgo } },
      orderBy: { recordedAt: "asc" },
      select: { activityIndex: true, qualityFlag: true },
    }),
    prisma.bioReading.findFirst({
      where: { plantId },
      orderBy: { recordedAt: "desc" },
      select: { activityIndex: true, recordedAt: true },
    }),
    prisma.bioResponseEvent.findMany({
      where: { plantId },
      orderBy: { eventAt: "desc" },
      take: 5,
    }),
    prisma.bioReading.count({ where: { plantId } }),
  ]);

  const hasDevice = total > 0;
  const activityVals = recent.map((r) => r.activityIndex).filter((v): v is number => v != null);
  const meanActivityIndex24h = mean(activityVals);
  const qualityOkRatio = recent.length
    ? recent.filter((r) => r.qualityFlag === "ok").length / recent.length
    : 0;
  const reactedCount = responses.filter((r) => r.reacted).length;
  const lastReaction = responses[0]
    ? {
        eventAt: responses[0].eventAt.toISOString(),
        eventType: responses[0].eventType,
        responseRatio: responses[0].responseRatio,
        latencyMin: responses[0].latencyMin,
        confidence: responses[0].confidence,
        reacted: responses[0].reacted,
      }
    : null;

  let text = "";
  if (hasDevice) {
    const parts: string[] = [];
    if (meanActivityIndex24h != null) {
      parts.push(`activité bioélectrique moyenne sur 24 h: ${(meanActivityIndex24h * 100).toFixed(0)}%`);
    }
    parts.push(`qualité de signal: ${(qualityOkRatio * 100).toFixed(0)}%`);
    if (lastReaction) {
      if (lastReaction.reacted) {
        const pct = Math.round((lastReaction.responseRatio - 1) * 100);
        const lat = lastReaction.latencyMin != null ? `, latence ~${Math.round(lastReaction.latencyMin)} min` : "";
        parts.push(
          `dernière réaction détectée à un arrosage le ${lastReaction.eventAt.slice(0, 10)}: +${pct}% d'activité${lat} (confiance ${lastReaction.confidence.toFixed(2)})`
        );
      } else {
        parts.push(`pas de réaction nette au dernier arrosage analysé (${lastReaction.eventAt.slice(0, 10)})`);
      }
    } else {
      parts.push("aucune réaction à un arrosage encore corrélée");
    }
    text = `Signal bioélectrique de la plante — ${parts.join("; ")}.`;
  }

  return {
    hasDevice,
    activity: {
      latestActivityIndex: latest?.activityIndex ?? null,
      meanActivityIndex24h,
      windows24h: recent.length,
      qualityOkRatio,
      lastReadingAt: latest?.recordedAt?.toISOString() ?? null,
    },
    responses: {
      total: responses.length,
      reactedCount,
      lastReaction,
    },
    text,
  };
}
