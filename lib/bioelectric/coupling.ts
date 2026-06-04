import type { PrismaClient } from "@prisma/client";
import { BIO_CONFIG } from "./config";

// Analyse de couplage environnement ↔ activité bioélectrique.
//
// Objectif: «comprendre» quelles données pilotent le signal bio. Pour chaque
// variable mesurée par le Pico environnemental (humidité du sol, températures,
// humidité de l'air, lumière, pression) on calcule la corrélation de Pearson
// décalée (lag) avec l'indice d'activité bioélectrique: l'environnement précède
// la réaction de la plante, on cherche donc le retard qui maximise |r|.

export type EnvChannelKey =
  | "soilMoisturePct"
  | "soilTempC"
  | "airTempC"
  | "airHumidityPct"
  | "lightLux"
  | "pressureHpa";

const CHANNEL_LABELS: Record<EnvChannelKey, string> = {
  soilMoisturePct: "humidité du sol",
  soilTempC: "température du sol",
  airTempC: "température de l'air",
  airHumidityPct: "humidité de l'air",
  lightLux: "lumière",
  pressureHpa: "pression",
};

const CHANNELS: EnvChannelKey[] = [
  "soilMoisturePct",
  "soilTempC",
  "airTempC",
  "airHumidityPct",
  "lightLux",
  "pressureHpa",
];

export type ChannelCoupling = {
  channel: EnvChannelKey;
  label: string;
  /** Corrélation de Pearson signée au meilleur retard (-1..1). */
  correlation: number;
  /** Retard en minutes (l'environnement précède l'activité bio). */
  lagMin: number;
  /** Nombre de paires (bio, env) utilisées. */
  pairs: number;
  /** Confiance 0-1 (croît avec |r| et le nombre de paires). */
  confidence: number;
};

export type EnvironmentalCoupling = {
  /** Couplages triés du plus fort (|r|) au plus faible, seuils respectés. */
  channels: ChannelCoupling[];
  /** Couplage dominant (|r| max) au-dessus du seuil de fiabilité, sinon null. */
  dominant: ChannelCoupling | null;
  /** Fenêtre analysée et taille de l'échantillon bio. */
  lookbackHours: number;
  bioSamples: number;
  /** Résumé FR court, vide si pas de signal exploitable. */
  text: string;
};

type TimePoint = { t: number; v: number };
type EnvRow = { recordedAt: Date } & Partial<Record<EnvChannelKey, number | null>>;
type BioRow = { recordedAt: Date; activityIndex: number | null };

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx <= 1e-9 || vy <= 1e-9) return null; // série constante => corrélation indéfinie
  return cov / Math.sqrt(vx * vy);
}

/** Valeur env interpolée/au plus proche à l'instant `t`, dans la tolérance. */
function sampleAt(series: TimePoint[], t: number, toleranceMs: number): number | null {
  if (series.length === 0) return null;
  // Recherche linéaire du point le plus proche (séries courtes, bornées par take()).
  let best: TimePoint | null = null;
  let bestDt = Infinity;
  for (const p of series) {
    const dt = Math.abs(p.t - t);
    if (dt < bestDt) {
      bestDt = dt;
      best = p;
    } else if (p.t > t && dt > bestDt) {
      break; // série triée: on s'éloigne, inutile de continuer
    }
  }
  return best != null && bestDt <= toleranceMs ? best.v : null;
}

function parseLags(): number[] {
  return BIO_CONFIG.couplingLagsMin
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0);
}

/**
 * Calcule le couplage environnement ↔ activité bioélectrique sur la fenêtre
 * récente. Pur (testable): prend des séries déjà chargées.
 */
export function computeCoupling(bio: BioRow[], env: EnvRow[]): EnvironmentalCoupling {
  const lookbackHours = BIO_CONFIG.couplingLookbackHours;
  const toleranceMs = BIO_CONFIG.couplingMatchToleranceMin * 60_000;
  const minPairs = BIO_CONFIG.couplingMinPairs;
  const lags = parseLags();

  const bioPoints: TimePoint[] = bio
    .filter((b) => finite(b.activityIndex))
    .map((b) => ({ t: new Date(b.recordedAt).getTime(), v: b.activityIndex as number }))
    .sort((a, b) => a.t - b.t);

  const empty: EnvironmentalCoupling = {
    channels: [],
    dominant: null,
    lookbackHours,
    bioSamples: bioPoints.length,
    text: "",
  };
  if (bioPoints.length < minPairs) return empty;

  const results: ChannelCoupling[] = [];
  for (const channel of CHANNELS) {
    const series: TimePoint[] = env
      .map((r) => ({ t: new Date(r.recordedAt).getTime(), v: r[channel] }))
      .filter((p): p is TimePoint => finite(p.v))
      .sort((a, b) => a.t - b.t);
    if (series.length < minPairs) continue;

    let bestAbs = 0;
    let best: ChannelCoupling | null = null;
    for (const lagMin of lags) {
      const lagMs = lagMin * 60_000;
      const xs: number[] = [];
      const ys: number[] = [];
      for (const bp of bioPoints) {
        // L'environnement précède la réaction: on échantillonne env à t - lag.
        const envVal = sampleAt(series, bp.t - lagMs, toleranceMs);
        if (envVal == null) continue;
        xs.push(envVal);
        ys.push(bp.v);
      }
      if (xs.length < minPairs) continue;
      const r = pearson(xs, ys);
      if (r == null) continue;
      if (Math.abs(r) > bestAbs) {
        bestAbs = Math.abs(r);
        // Confiance: |r| pondéré par la taille d'échantillon (saturation ~40 paires).
        const confidence = clamp01(Math.abs(r) * Math.min(1, xs.length / 40));
        best = {
          channel,
          label: CHANNEL_LABELS[channel],
          correlation: Math.round(r * 1000) / 1000,
          lagMin,
          pairs: xs.length,
          confidence: Math.round(confidence * 1000) / 1000,
        };
      }
    }
    if (best) results.push(best);
  }

  results.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
  const dominant = results.find((c) => Math.abs(c.correlation) >= 0.35 && c.pairs >= minPairs) ?? null;

  let text = "";
  if (dominant) {
    const sign = dominant.correlation >= 0 ? "augmente" : "baisse";
    const lag = dominant.lagMin > 0 ? ` (retard ~${dominant.lagMin} min)` : " (quasi immédiat)";
    text = `L'activité bioélectrique ${sign} avec ${dominant.label}${lag}: r=${dominant.correlation.toFixed(
      2
    )} sur ${dominant.pairs} fenêtres.`;
    const others = results
      .filter((c) => c !== dominant && Math.abs(c.correlation) >= 0.3)
      .slice(0, 2)
      .map((c) => `${c.label} (r=${c.correlation.toFixed(2)})`);
    if (others.length) text += ` Couplages secondaires: ${others.join(", ")}.`;
  }

  return { channels: results, dominant, lookbackHours, bioSamples: bioPoints.length, text };
}

/**
 * Charge les séries récentes et calcule le couplage pour une plante.
 * Renvoie un résultat vide (sans erreur) si aucun signal exploitable.
 */
export async function analyzeEnvironmentalCoupling(
  prisma: PrismaClient,
  plantId: string
): Promise<EnvironmentalCoupling> {
  const since = new Date(Date.now() - BIO_CONFIG.couplingLookbackHours * 3_600_000);
  const [bio, env] = await Promise.all([
    prisma.bioReading.findMany({
      where: { plantId, recordedAt: { gte: since } },
      orderBy: { recordedAt: "asc" },
      select: { recordedAt: true, activityIndex: true },
    }),
    prisma.reading.findMany({
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
    }),
  ]);
  return computeCoupling(bio, env);
}
