import type { BioReading, BioResponseEvent, PrismaClient } from "@prisma/client";
import { BIO_CONFIG } from "./config";
import type { BioelectricPayload } from "@/lib/schemas";

type BioLike = Pick<
  BioReading,
  | "recordedAt"
  | "rmsRaw"
  | "rmsUv"
  | "stdRaw"
  | "p2pRaw"
  | "slopeRawPerSec"
  | "spikeCount"
  | "zeroCrossRate"
  | "bandLowEnergy"
  | "bandMidEnergy"
  | "bandHighEnergy"
  | "qualityFlag"
  | "windowSeconds"
  | "waveform"
>;

export type BioMlPattern =
  | "baseline"
  | "recoverable_noise"
  | "spike_burst"
  | "slow_drift"
  | "flatline"
  | "saturation"
  | "unknown";

export type BioSignalMl = {
  activityIndex: number | null;
  signalConfidence: number;
  pattern: BioMlPattern;
  denoisedWaveform: number[];
  learnedFromWindows: number;
  baselineRms: number | null;
};

type Profile = {
  count: number;
  baselineRms: number | null;
  activityPrior: number;
  responseReward: number;
  qualityOkRatio: number;
  stats: {
    rms: RobustStat;
    std: RobustStat;
    p2p: RobustStat;
    slope: RobustStat;
    spikeRate: RobustStat;
    zcr: RobustStat;
    highRatio: RobustStat;
  };
  templateWaveform: number[];
};

type RobustStat = { median: number; mad: number };

const MIN_PROFILE_WINDOWS = 6;
const MAX_HISTORY = 240;

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function robustStat(values: number[]): RobustStat {
  const med = median(values) ?? 0;
  const deviations = values.map((v) => Math.abs(v - med));
  return { median: med, mad: Math.max(median(deviations) ?? 0, 1e-6) };
}

function robustZ(value: number | null, stat: RobustStat): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.abs(value - stat.median) / (1.4826 * stat.mad + 1e-6);
}

function rmsOf(reading: Pick<BioLike, "rmsRaw" | "rmsUv">): number | null {
  if (finite(reading.rmsRaw) && reading.rmsRaw > 0) return reading.rmsRaw;
  if (finite(reading.rmsUv) && reading.rmsUv > 0) return reading.rmsUv;
  return null;
}

function spikeRateOf(reading: Pick<BioLike, "spikeCount" | "windowSeconds">): number {
  const spikes = finite(reading.spikeCount) ? reading.spikeCount : 0;
  const seconds = finite(reading.windowSeconds) && reading.windowSeconds > 0 ? reading.windowSeconds : 1;
  return spikes / seconds;
}

function highRatioOf(reading: Pick<BioLike, "bandLowEnergy" | "bandMidEnergy" | "bandHighEnergy">): number {
  const low = finite(reading.bandLowEnergy) ? reading.bandLowEnergy : 0;
  const mid = finite(reading.bandMidEnergy) ? reading.bandMidEnergy : 0;
  const high = finite(reading.bandHighEnergy) ? reading.bandHighEnergy : 0;
  const total = low + mid + high;
  return total > 0 ? high / total : 0;
}

function parseWaveform(value: string | null | undefined): number[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(finite).map((v) => clamp(v)) : [];
  } catch {
    return [];
  }
}

function medianFilter(points: number[], radius = 1): number[] {
  if (points.length < 3) return points;
  return points.map((_, i) => {
    const lo = Math.max(0, i - radius);
    const hi = Math.min(points.length, i + radius + 1);
    return median(points.slice(lo, hi)) ?? points[i];
  });
}

function averageWaveforms(waves: number[][]): number[] {
  if (waves.length === 0) return [];
  const len = Math.min(...waves.map((w) => w.length));
  if (len < 2) return [];
  const out: number[] = [];
  for (let i = 0; i < len; i++) {
    out.push((median(waves.map((w) => w[i])) ?? 0.5));
  }
  return out;
}

function waveformSimilarity(a: number[], b: number[]): number | null {
  const len = Math.min(a.length, b.length);
  if (len < 8) return null;
  let error = 0;
  for (let i = 0; i < len; i++) error += Math.abs(a[i] - b[i]);
  return clamp(1 - error / len / 0.35);
}

function qualityPrior(flag: string | null | undefined): number {
  switch (flag) {
    case "ok": return 0.95;
    case "noisy": return 0.42;
    case "floating": return 0.18;
    case "saturated": return 0.12;
    case "flatline": return 0.08;
    default: return 0.35;
  }
}

function toReading(payload: BioelectricPayload): BioLike {
  return {
    recordedAt: payload.recordedAt ? new Date(payload.recordedAt) : new Date(),
    rmsRaw: payload.rmsRaw ?? null,
    rmsUv: payload.rmsUv ?? null,
    stdRaw: payload.stdRaw ?? null,
    p2pRaw: payload.p2pRaw ?? null,
    slopeRawPerSec: payload.slopeRawPerSec ?? null,
    spikeCount: payload.spikeCount ?? null,
    zeroCrossRate: payload.zeroCrossRate ?? null,
    bandLowEnergy: payload.bandLowEnergy ?? null,
    bandMidEnergy: payload.bandMidEnergy ?? null,
    bandHighEnergy: payload.bandHighEnergy ?? null,
    qualityFlag: payload.qualityFlag ?? null,
    windowSeconds: payload.windowSeconds,
    waveform: payload.waveform ? JSON.stringify(payload.waveform) : null,
  };
}

function learnProfile(history: BioLike[], responses: BioResponseEvent[], fallbackBaseline: number | null): Profile {
  const usable = history
    .filter((r) => rmsOf(r) != null)
    .slice(-MAX_HISTORY);
  const reliable = usable.filter((r) => r.qualityFlag === "ok");
  const training = reliable.length >= MIN_PROFILE_WINDOWS ? reliable : usable;
  const rmsVals = training.map(rmsOf).filter(finite);
  const baselineRms = median(rmsVals) ?? fallbackBaseline;
  const activityVals = rmsVals
    .filter((v) => baselineRms != null && baselineRms > 0)
    .map((v) => clamp(v / ((baselineRms as number) * BIO_CONFIG.activitySaturationFactor)));

  const responseScores = responses.slice(0, 30).map((r) => {
    const signed = r.reacted ? 1 : -0.35;
    return signed * clamp((r.confidence ?? 0) * Math.min(1.5, Math.max(0, r.responseRatio - 1)));
  });
  const responseReward = responseScores.length
    ? clamp(0.5 + responseScores.reduce((a, b) => a + b, 0) / responseScores.length)
    : 0.5;

  const waves = training
    .map((r) => medianFilter(parseWaveform(r.waveform)))
    .filter((w) => w.length >= 8);

  return {
    count: training.length,
    baselineRms,
    activityPrior: median(activityVals) ?? 0.35,
    responseReward,
    qualityOkRatio: usable.length ? usable.filter((r) => r.qualityFlag === "ok").length / usable.length : 0.5,
    stats: {
      rms: robustStat(rmsVals),
      std: robustStat(training.map((r) => r.stdRaw).filter(finite)),
      p2p: robustStat(training.map((r) => r.p2pRaw).filter(finite)),
      slope: robustStat(training.map((r) => Math.abs(r.slopeRawPerSec ?? 0)).filter(finite)),
      spikeRate: robustStat(training.map(spikeRateOf)),
      zcr: robustStat(training.map((r) => r.zeroCrossRate).filter(finite)),
      highRatio: robustStat(training.map(highRatioOf)),
    },
    templateWaveform: averageWaveforms(waves),
  };
}

function classifyPattern(reading: BioLike, confidence: number, profile: Profile): BioMlPattern {
  if (reading.qualityFlag === "saturated") return "saturation";
  if (reading.qualityFlag === "flatline") return "flatline";

  const spikeZ = robustZ(spikeRateOf(reading), profile.stats.spikeRate);
  const slopeZ = robustZ(Math.abs(reading.slopeRawPerSec ?? 0), profile.stats.slope);
  const highZ = robustZ(highRatioOf(reading), profile.stats.highRatio);
  const stdZ = robustZ(reading.stdRaw ?? null, profile.stats.std);

  if (spikeZ > 3.2) return "spike_burst";
  if (slopeZ > 3.2) return "slow_drift";
  if (reading.qualityFlag === "noisy" && confidence >= 0.45) return "recoverable_noise";
  if (highZ > 3.5 || stdZ > 3.5) return confidence >= 0.45 ? "recoverable_noise" : "unknown";
  return profile.count >= MIN_PROFILE_WINDOWS ? "baseline" : "unknown";
}

export function analyzeBioReadingWithProfile(
  reading: BioLike,
  profile: Profile,
  fallbackBaseline: number | null
): BioSignalMl {
  const rms = rmsOf(reading);
  const baselineRms = profile.baselineRms ?? fallbackBaseline;
  const waveform = medianFilter(parseWaveform(reading.waveform));
  const similarity = waveformSimilarity(waveform, profile.templateWaveform);

  const zParts = [
    robustZ(rms, profile.stats.rms),
    robustZ(reading.stdRaw ?? null, profile.stats.std),
    robustZ(reading.p2pRaw ?? null, profile.stats.p2p),
    robustZ(Math.abs(reading.slopeRawPerSec ?? 0), profile.stats.slope),
    robustZ(spikeRateOf(reading), profile.stats.spikeRate),
    robustZ(reading.zeroCrossRate ?? null, profile.stats.zcr),
    robustZ(highRatioOf(reading), profile.stats.highRatio),
  ];
  const robustDistance = zParts.reduce((a, b) => a + Math.min(b, 6), 0) / zParts.length;
  const patternFit = profile.count >= MIN_PROFILE_WINDOWS ? Math.exp(-robustDistance / 2.8) : 0.45;
  const shapeFit = similarity ?? patternFit;
  const prior = qualityPrior(reading.qualityFlag);
  const rewardBoost = 0.85 + profile.responseReward * 0.3;

  const confidence = clamp(
    (prior * 0.45 + patternFit * 0.35 + shapeFit * 0.2) *
      rewardBoost *
      (0.65 + 0.35 * Math.min(1, profile.count / 30))
  );

  let activityIndex: number | null = null;
  if (rms != null && baselineRms != null && baselineRms > 0) {
    const rawActivity = clamp(rms / (baselineRms * BIO_CONFIG.activitySaturationFactor));
    const denoised = confidence * rawActivity + (1 - confidence) * profile.activityPrior;
    activityIndex = clamp(denoised);
  }

  const denoisedWaveform = waveform.length
    ? waveform.map((v, i) => {
        const template = profile.templateWaveform[i] ?? v;
        const blend = confidence >= 0.75 ? 0.15 : confidence >= 0.45 ? 0.35 : 0.55;
        return Math.round(clamp(v * (1 - blend) + template * blend) * 10000) / 10000;
      })
    : [];

  return {
    activityIndex,
    signalConfidence: Math.round(confidence * 1000) / 1000,
    pattern: classifyPattern(reading, confidence, profile),
    denoisedWaveform,
    learnedFromWindows: profile.count,
    baselineRms,
  };
}

export async function analyzeAdaptiveBioSignal(
  prisma: PrismaClient,
  plantId: string,
  payload: BioelectricPayload,
  fallbackBaseline: number | null
): Promise<BioSignalMl> {
  const [history, responses] = await Promise.all([
    prisma.bioReading.findMany({
      where: { plantId },
      orderBy: { recordedAt: "asc" },
      take: MAX_HISTORY,
    }),
    prisma.bioResponseEvent.findMany({
      where: { plantId },
      orderBy: { eventAt: "desc" },
      take: 30,
    }),
  ]);
  const profile = learnProfile(history, responses, fallbackBaseline);
  return analyzeBioReadingWithProfile(toReading(payload), profile, fallbackBaseline);
}

export function analyzeStoredBioReadings(
  readings: BioReading[],
  responses: BioResponseEvent[],
  fallbackBaseline: number | null
): Map<string, BioSignalMl> {
  const chronological = [...readings].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
  );
  const profile = learnProfile(chronological, responses, fallbackBaseline);
  return new Map(chronological.map((r) => [r.id, analyzeBioReadingWithProfile(r, profile, fallbackBaseline)]));
}
