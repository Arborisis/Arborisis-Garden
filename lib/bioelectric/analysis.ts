import type { PrismaClient, Plant, BioReading, BioResponseEvent } from "@prisma/client";
import { BIO_CONFIG } from "./config";
import type { BioSummary, BioStimulusStat } from "./types";
import { analyzeEnvironmentalCoupling } from "./coupling";

const STIMULUS_LABELS: Record<string, string> = {
  watering: "arrosage",
  light: "lumière",
  temp: "température",
  humidity: "humidité de l'air",
  pressure: "pression",
  unknown: "stimulus",
};

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

// ---- détection d'évènements environnementaux (multi-stimuli) ----------------

export type BioEventType = "watering" | "light" | "temp" | "humidity" | "pressure";

export type EnvEvent = {
  at: Date;
  type: BioEventType;
  /** Sens du pas: "up" (montée) ou "down" (descente). */
  direction: "up" | "down";
  /** Amplitude du pas dans l'unité native du canal (toujours positive). */
  magnitude: number;
  /** Canal source ("soilMoisturePct", "lightLux", ...). */
  channel: string;
};

type EnvReadingRow = {
  recordedAt: Date;
  soilMoisturePct: number | null;
  soilTempC: number | null;
  airTempC: number | null;
  airHumidityPct: number | null;
  lightLux: number | null;
  pressureHpa: number | null;
};

type ChannelSpec = {
  type: BioEventType;
  channel: keyof EnvReadingRow;
  threshold: number;
  /** "up" = arrosage (montée seule); "both" = stimulus bidirectionnel. */
  detect: "up" | "both";
  /** Transforme la valeur avant calcul du pas (ex: log pour la lumière). */
  transform?: (v: number) => number;
};

function logLux(v: number): number {
  return Math.log(Math.max(0, v) + 1);
}

function channelSpecs(): ChannelSpec[] {
  return [
    { type: "watering", channel: "soilMoisturePct", threshold: BIO_CONFIG.wateringMoistureJumpPct, detect: "up" },
    { type: "light", channel: "lightLux", threshold: BIO_CONFIG.lightStepLogRatio, detect: "both", transform: logLux },
    { type: "temp", channel: "airTempC", threshold: BIO_CONFIG.tempStepC, detect: "both" },
    { type: "temp", channel: "soilTempC", threshold: BIO_CONFIG.tempStepC, detect: "both" },
    { type: "humidity", channel: "airHumidityPct", threshold: BIO_CONFIG.humidityStepPct, detect: "both" },
    { type: "pressure", channel: "pressureHpa", threshold: BIO_CONFIG.pressureStepHpa, detect: "both" },
  ];
}

/** Détecte les pas significatifs d'un canal sur une fenêtre glissante. */
function detectStepsForChannel(readings: EnvReadingRow[], spec: ChannelSpec): EnvEvent[] {
  const raw = readings
    .map((r) => ({ t: r.recordedAt.getTime(), v: r[spec.channel] as number | null }))
    .filter((p): p is { t: number; v: number } => typeof p.v === "number" && Number.isFinite(p.v))
    .map((p) => ({ t: p.t, v: spec.transform ? spec.transform(p.v) : p.v }))
    .sort((a, b) => a.t - b.t);

  const windowMs = BIO_CONFIG.stimulusWindowMin * 60000;
  const out: EnvEvent[] = [];
  for (let i = 1; i < raw.length; i++) {
    let j = i - 1;
    while (j > 0 && raw[i].t - raw[j - 1].t <= windowMs) j--;
    const delta = raw[i].v - raw[j].v;
    const direction: "up" | "down" = delta >= 0 ? "up" : "down";
    if (spec.detect === "up" && direction !== "up") continue;
    if (Math.abs(delta) < spec.threshold) continue;
    out.push({ at: new Date(raw[i].t), type: spec.type, direction, magnitude: Math.abs(delta), channel: String(spec.channel) });
  }
  return out;
}

/**
 * Détecte tous les évènements environnementaux (arrosage, lumière, température,
 * humidité, pression) dans une série de mesures. Les évènements d'un même type
 * rapprochés (< responseWindowMin) sont fusionnés en gardant le plus marqué —
 * cela évite aussi les collisions sur la contrainte unique (plantId, type, at).
 */
export function detectEnvironmentEvents(readings: EnvReadingRow[]): EnvEvent[] {
  const mergeMs = BIO_CONFIG.responseWindowMin * 60000;
  const all = channelSpecs().flatMap((spec) => detectStepsForChannel(readings, spec));

  const byType = new Map<BioEventType, EnvEvent[]>();
  for (const ev of all.sort((a, b) => a.at.getTime() - b.at.getTime())) {
    const bucket = byType.get(ev.type) ?? [];
    const last = bucket[bucket.length - 1];
    if (last && ev.at.getTime() - last.at.getTime() < mergeMs) {
      if (ev.magnitude > last.magnitude) bucket[bucket.length - 1] = ev;
    } else {
      bucket.push(ev);
    }
    byType.set(ev.type, bucket);
  }
  return [...byType.values()].flat().sort((a, b) => a.at.getTime() - b.at.getTime());
}

// Compat. ascendante: ancienne API ne détectant que l'arrosage.
export type WateringEvent = { at: Date; rise: number };
export function detectWateringEvents(
  readings: { recordedAt: Date; soilMoisturePct: number | null }[]
): WateringEvent[] {
  const rows = readings.map((r) => ({
    recordedAt: r.recordedAt,
    soilMoisturePct: r.soilMoisturePct,
    soilTempC: null,
    airTempC: null,
    airHumidityPct: null,
    lightLux: null,
    pressureHpa: null,
  }));
  return detectEnvironmentEvents(rows)
    .filter((e) => e.type === "watering")
    .map((e) => ({ at: e.at, rise: e.magnitude }));
}

// ---- détection de réaction --------------------------------------------------

export type DetectResponsesOptions = { sinceHours: number };

/**
 * Pour chaque stimulus environnemental détecté sur la période (arrosage,
 * lumière, température, humidité, pression), compare l'activité bio d'une
 * fenêtre baseline (avant) à celle d'une fenêtre réponse (après) et décide si
 * la plante a réagi. La réaction est bidirectionnelle: un écart marqué de
 * l'activité (hausse OU baisse) compte. Upsert idempotent dans BioResponseEvent.
 */
export async function detectResponses(
  prisma: PrismaClient,
  plantId: string,
  opts: DetectResponsesOptions
): Promise<number> {
  const since = new Date(Date.now() - opts.sinceHours * 3_600_000);

  const envReadings = await prisma.reading.findMany({
    where: { plantId, recordedAt: { gte: since } },
    orderBy: { recordedAt: "asc" },
    select: {
      recordedAt: true,
      soilMoisturePct: true,
      soilTempC: true,
      airTempC: true,
      airHumidityPct: true,
      lightLux: true,
      pressureHpa: true,
    },
  });
  const events = detectEnvironmentEvents(envReadings);
  if (events.length === 0) return 0;

  const baselineMs = BIO_CONFIG.baselineWindowMin * 60000;
  const responseMs = BIO_CONFIG.responseWindowMin * 60000;
  // Réaction = écart relatif d'activité dans un sens OU l'autre.
  const upThreshold = BIO_CONFIG.reactionRatioThreshold;
  const downThreshold = 1 / BIO_CONFIG.reactionRatioThreshold;

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

    // Pic = fenêtre qui s'écarte le plus de la baseline (dans un sens ou l'autre).
    let peak = respWin[0];
    let peakDev = Math.abs((rmsOf(peak) as number) - baselineRms);
    for (const b of respWin) {
      const dev = Math.abs((rmsOf(b) as number) - baselineRms);
      if (dev > peakDev) {
        peakDev = dev;
        peak = b;
      }
    }
    const latencyMin = (peak.recordedAt.getTime() - t) / 60000;

    const all = [...baseWin, ...respWin];
    const qualityOkRatio = all.filter((b) => b.qualityFlag === "ok").length / all.length;
    const reacted = (responseRatio >= upThreshold || responseRatio <= downThreshold) && qualityOkRatio >= 0.5;
    const confidence = clamp01(
      Math.min(1, all.length / 12) * Math.max(0.2, qualityOkRatio) * Math.min(1, Math.abs(responseRatio - 1))
    );

    const eventAt = roundToMinute(ev.at);
    const detail = JSON.stringify({
      stimulus: ev.type,
      channel: ev.channel,
      direction: ev.direction,
      magnitude: Math.round(ev.magnitude * 100) / 100,
      activityChange: responseRatio >= 1 ? "up" : "down",
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
      where: { plantId_eventType_eventAt: { plantId, eventType: ev.type, eventAt } },
      create: { plantId, eventType: ev.type, eventAt, ...data },
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

  const [recent, latest, responses, total, coupling] = await Promise.all([
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
      take: 100,
    }),
    prisma.bioReading.count({ where: { plantId } }),
    analyzeEnvironmentalCoupling(prisma, plantId).catch(() => null),
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
  const byStimulus = summarizeByStimulus(responses);
  const couplingSummary = {
    dominant: coupling?.dominant
      ? {
          channel: coupling.dominant.channel,
          label: coupling.dominant.label,
          correlation: coupling.dominant.correlation,
          lagMin: coupling.dominant.lagMin,
          confidence: coupling.dominant.confidence,
        }
      : null,
    channels: (coupling?.channels ?? []).map((c) => ({
      channel: c.channel,
      label: c.label,
      correlation: c.correlation,
      lagMin: c.lagMin,
      confidence: c.confidence,
    })),
  };

  let text = "";
  if (hasDevice) {
    const parts: string[] = [];
    if (meanActivityIndex24h != null) {
      parts.push(`activité bioélectrique moyenne sur 24 h: ${(meanActivityIndex24h * 100).toFixed(0)}%`);
    }
    parts.push(`qualité de signal: ${(qualityOkRatio * 100).toFixed(0)}%`);
    if (lastReaction) {
      const label = STIMULUS_LABELS[lastReaction.eventType] ?? lastReaction.eventType;
      if (lastReaction.reacted) {
        const delta = Math.round((lastReaction.responseRatio - 1) * 100);
        const sign = delta >= 0 ? `+${delta}` : `${delta}`;
        const lat = lastReaction.latencyMin != null ? `, latence ~${Math.round(lastReaction.latencyMin)} min` : "";
        parts.push(
          `dernière réaction (${label}, ${lastReaction.eventAt.slice(0, 10)}): ${sign}% d'activité${lat} (confiance ${lastReaction.confidence.toFixed(2)})`
        );
      } else {
        parts.push(`pas de réaction nette au dernier stimulus (${label}, ${lastReaction.eventAt.slice(0, 10)})`);
      }
    } else {
      parts.push("aucune réaction à un stimulus encore corrélée");
    }
    const reactive = byStimulus.filter((s) => s.reactedCount > 0);
    if (reactive.length) {
      const top = reactive
        .slice(0, 3)
        .map((s) => {
          const label = STIMULUS_LABELS[s.eventType] ?? s.eventType;
          return `${label} ${Math.round(s.reactedRatio * 100)}% (${s.reactedCount}/${s.events})`;
        })
        .join(", ");
      parts.push(`réactivité par stimulus: ${top}`);
    }
    if (coupling?.text) parts.push(coupling.text.replace(/\.$/, ""));
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
      byStimulus,
    },
    coupling: couplingSummary,
    text,
  };
}

/** Agrège les réactions par type de stimulus (les plus réactifs d'abord). */
function summarizeByStimulus(responses: BioResponseEvent[]): BioStimulusStat[] {
  const groups = new Map<string, BioResponseEvent[]>();
  for (const r of responses) {
    const bucket = groups.get(r.eventType) ?? [];
    bucket.push(r);
    groups.set(r.eventType, bucket);
  }
  const stats: BioStimulusStat[] = [];
  for (const [eventType, evs] of groups) {
    const reactedCount = evs.filter((e) => e.reacted).length;
    const latencies = evs.map((e) => e.latencyMin).filter((v): v is number => v != null);
    stats.push({
      eventType,
      events: evs.length,
      reactedCount,
      reactedRatio: evs.length ? reactedCount / evs.length : 0,
      avgResponseRatio: mean(evs.map((e) => e.responseRatio)) ?? 1,
      avgLatencyMin: latencies.length ? mean(latencies) : null,
    });
  }
  return stats.sort((a, b) => b.reactedRatio - a.reactedRatio || b.events - a.events);
}
