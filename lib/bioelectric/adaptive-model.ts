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
  | "electrode_shift"
  | "rhythmic_pulse"
  | "stress_response"
  | "flatline"
  | "saturation"
  | "unknown";

export type BioSignalMl = {
  activityIndex: number | null;
  signalConfidence: number;
  pattern: BioMlPattern;
  anomalyScore: number;
  stressScore: number;
  rhythmScore: number;
  stabilityScore: number;
  spectralBalance: {
    low: number;
    mid: number;
    high: number;
    entropy: number;
  };
  reasons: string[];
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
    lowRatio: RobustStat;
    midRatio: RobustStat;
    highRatio: RobustStat;
    spectralEntropy: RobustStat;
    waveformRange: RobustStat;
    waveformVolatility: RobustStat;
    waveformSlope: RobustStat;
    turningRate: RobustStat;
  };
  templateWaveform: number[];
};

type RobustStat = { median: number; mad: number };
type WaveformFeatures = { range: number; volatility: number; slope: number; turningRate: number };
type EnergyBalance = { low: number; mid: number; high: number; entropy: number };
type FeatureSnapshot = {
  rms: number | null;
  std: number | null;
  p2p: number | null;
  absSlope: number;
  spikeRate: number;
  zcr: number | null;
  energy: EnergyBalance;
  waveform: WaveformFeatures;
};
type FeatureZ = {
  rms: number;
  std: number;
  p2p: number;
  slope: number;
  spikeRate: number;
  zcr: number;
  lowRatio: number;
  midRatio: number;
  highRatio: number;
  spectralEntropy: number;
  waveformRange: number;
  waveformVolatility: number;
  waveformSlope: number;
  turningRate: number;
};

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

function signedRobustZ(value: number | null, stat: RobustStat): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return (value - stat.median) / (1.4826 * stat.mad + 1e-6);
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

function energyBalanceOf(reading: Pick<BioLike, "bandLowEnergy" | "bandMidEnergy" | "bandHighEnergy">): EnergyBalance {
  const low = finite(reading.bandLowEnergy) ? reading.bandLowEnergy : 0;
  const mid = finite(reading.bandMidEnergy) ? reading.bandMidEnergy : 0;
  const high = finite(reading.bandHighEnergy) ? reading.bandHighEnergy : 0;
  const total = low + mid + high;
  if (total <= 0) return { low: 0, mid: 0, high: 0, entropy: 0 };
  const ratios = [low / total, mid / total, high / total];
  const entropy = ratios.reduce((sum, ratio) => (ratio > 0 ? sum - ratio * Math.log(ratio) : sum), 0) / Math.log(3);
  return {
    low: ratios[0],
    mid: ratios[1],
    high: ratios[2],
    entropy: clamp(entropy),
  };
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

function smoothWaveform(points: number[]): number[] {
  const filtered = medianFilter(points, 2);
  if (filtered.length < 3) return filtered;
  return filtered.map((point, i) => {
    const previous = filtered[Math.max(0, i - 1)];
    const next = filtered[Math.min(filtered.length - 1, i + 1)];
    return clamp(previous * 0.2 + point * 0.6 + next * 0.2);
  });
}

function waveformFeatures(points: number[]): WaveformFeatures {
  if (points.length < 2) return { range: 0, volatility: 0, slope: 0, turningRate: 0 };
  const min = Math.min(...points);
  const max = Math.max(...points);
  const diffs: number[] = [];
  let turns = 0;
  let previousSign = 0;
  for (let i = 1; i < points.length; i++) {
    const diff = points[i] - points[i - 1];
    diffs.push(Math.abs(diff));
    const sign = diff > 1e-5 ? 1 : diff < -1e-5 ? -1 : 0;
    if (sign !== 0 && previousSign !== 0 && sign !== previousSign) turns++;
    if (sign !== 0) previousSign = sign;
  }
  return {
    range: max - min,
    volatility: diffs.reduce((a, b) => a + b, 0) / diffs.length,
    slope: points[points.length - 1] - points[0],
    turningRate: turns / Math.max(1, points.length - 2),
  };
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

function snapshotOf(reading: BioLike, waveform: number[] = smoothWaveform(parseWaveform(reading.waveform))): FeatureSnapshot {
  return {
    rms: rmsOf(reading),
    std: reading.stdRaw ?? null,
    p2p: reading.p2pRaw ?? null,
    absSlope: Math.abs(reading.slopeRawPerSec ?? 0),
    spikeRate: spikeRateOf(reading),
    zcr: reading.zeroCrossRate ?? null,
    energy: energyBalanceOf(reading),
    waveform: waveformFeatures(waveform),
  };
}

function featureZ(snapshot: FeatureSnapshot, profile: Profile): FeatureZ {
  return {
    rms: robustZ(snapshot.rms, profile.stats.rms),
    std: robustZ(snapshot.std, profile.stats.std),
    p2p: robustZ(snapshot.p2p, profile.stats.p2p),
    slope: robustZ(snapshot.absSlope, profile.stats.slope),
    spikeRate: robustZ(snapshot.spikeRate, profile.stats.spikeRate),
    zcr: robustZ(snapshot.zcr, profile.stats.zcr),
    lowRatio: robustZ(snapshot.energy.low, profile.stats.lowRatio),
    midRatio: robustZ(snapshot.energy.mid, profile.stats.midRatio),
    highRatio: robustZ(snapshot.energy.high, profile.stats.highRatio),
    spectralEntropy: robustZ(snapshot.energy.entropy, profile.stats.spectralEntropy),
    waveformRange: robustZ(snapshot.waveform.range, profile.stats.waveformRange),
    waveformVolatility: robustZ(snapshot.waveform.volatility, profile.stats.waveformVolatility),
    waveformSlope: robustZ(Math.abs(snapshot.waveform.slope), profile.stats.waveformSlope),
    turningRate: robustZ(snapshot.waveform.turningRate, profile.stats.turningRate),
  };
}

function round3(value: number): number {
  return Math.round(clamp(value) * 1000) / 1000;
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

  const waveSnapshots = training
    .map((r) => smoothWaveform(parseWaveform(r.waveform)))
    .filter((w) => w.length >= 8);
  const snapshots = training.map((r) => snapshotOf(r));

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
      lowRatio: robustStat(snapshots.map((s) => s.energy.low)),
      midRatio: robustStat(snapshots.map((s) => s.energy.mid)),
      highRatio: robustStat(snapshots.map((s) => s.energy.high)),
      spectralEntropy: robustStat(snapshots.map((s) => s.energy.entropy)),
      waveformRange: robustStat(snapshots.map((s) => s.waveform.range)),
      waveformVolatility: robustStat(snapshots.map((s) => s.waveform.volatility)),
      waveformSlope: robustStat(snapshots.map((s) => Math.abs(s.waveform.slope))),
      turningRate: robustStat(snapshots.map((s) => s.waveform.turningRate)),
    },
    templateWaveform: averageWaveforms(waveSnapshots),
  };
}

function classifyPattern(
  reading: BioLike,
  confidence: number,
  profile: Profile,
  z: FeatureZ,
  snapshot: FeatureSnapshot,
  anomalyScore: number,
  stressScore: number,
  rhythmScore: number
): BioMlPattern {
  if (reading.qualityFlag === "saturated") return "saturation";
  if (reading.qualityFlag === "flatline") return "flatline";
  if (reading.qualityFlag === "floating" && (z.waveformSlope > 2.4 || z.waveformRange > 2.8)) return "electrode_shift";
  if (z.spikeRate > 3.2 || (z.highRatio > 3.2 && z.waveformVolatility > 2.4)) return "spike_burst";
  if (z.slope > 3.2 || z.waveformSlope > 3.2 || snapshot.energy.low > 0.72) return "slow_drift";
  if (reading.qualityFlag === "noisy" && confidence >= 0.45) return "recoverable_noise";
  if (stressScore >= 0.68 && confidence >= 0.45 && anomalyScore < 0.82) return "stress_response";
  if (
    rhythmScore >= 0.68 &&
    confidence >= 0.5 &&
    profile.count >= MIN_PROFILE_WINDOWS &&
    (z.rms > 1.6 || z.p2p > 1.6 || z.midRatio > 1.8 || (anomalyScore > 0.18 && anomalyScore < 0.65))
  ) {
    return "rhythmic_pulse";
  }
  if (z.highRatio > 3.5 || z.std > 3.5 || z.spectralEntropy > 3.5) {
    return confidence >= 0.45 ? "recoverable_noise" : "unknown";
  }
  return profile.count >= MIN_PROFILE_WINDOWS ? "baseline" : "unknown";
}

function explainSignal(z: FeatureZ, snapshot: FeatureSnapshot, profile: Profile, similarity: number | null): string[] {
  const reasons: string[] = [];
  const signedRmsZ = signedRobustZ(snapshot.rms, profile.stats.rms);
  const signedP2pZ = signedRobustZ(snapshot.p2p, profile.stats.p2p);
  if (profile.count < MIN_PROFILE_WINDOWS) reasons.push("profil encore jeune");
  if (signedRmsZ > 2.2) reasons.push("RMS au-dessus de la baseline");
  if (signedP2pZ > 2.2) reasons.push("amplitude crête-à-crête élevée");
  if (z.spikeRate > 2.6) reasons.push("pics plus fréquents que d'habitude");
  if (z.slope > 2.6 || z.waveformSlope > 2.6) reasons.push("dérive lente détectée");
  if (z.highRatio > 2.6) reasons.push("énergie haute fréquence inhabituelle");
  if (snapshot.energy.low > 0.72) reasons.push("signal dominé par les basses fréquences");
  if (similarity != null && similarity > 0.75) reasons.push("forme d'onde proche du motif appris");
  return reasons.slice(0, 4);
}

export function analyzeBioReadingWithProfile(
  reading: BioLike,
  profile: Profile,
  fallbackBaseline: number | null
): BioSignalMl {
  const rms = rmsOf(reading);
  const baselineRms = profile.baselineRms ?? fallbackBaseline;
  const waveform = smoothWaveform(parseWaveform(reading.waveform));
  const similarity = waveformSimilarity(waveform, profile.templateWaveform);
  const snapshot = snapshotOf(reading, waveform);
  const z = featureZ(snapshot, profile);

  const zParts = [
    z.rms,
    z.std,
    z.p2p,
    z.slope,
    z.spikeRate,
    z.zcr,
    z.lowRatio,
    z.midRatio,
    z.highRatio,
    z.spectralEntropy,
    z.waveformRange,
    z.waveformVolatility,
    z.waveformSlope,
    z.turningRate,
  ];
  const robustDistance = zParts.reduce((a, b) => a + Math.min(b, 6), 0) / zParts.length;
  const patternFit = profile.count >= MIN_PROFILE_WINDOWS ? Math.exp(-robustDistance / 2.8) : 0.45;
  const shapeFit = similarity ?? patternFit;
  const prior = qualityPrior(reading.qualityFlag);
  const rewardBoost = 0.85 + profile.responseReward * 0.3;
  const sampleDepth = 0.65 + 0.35 * Math.min(1, profile.count / 30);
  const spectralFit = profile.count >= MIN_PROFILE_WINDOWS ? Math.exp(-z.spectralEntropy / 3.2) : 0.55;
  const electrodePenalty =
    reading.qualityFlag === "floating" ? 0.55 : reading.qualityFlag === "saturated" || reading.qualityFlag === "flatline" ? 0.35 : 1;

  const confidence = clamp(
    (prior * 0.36 + patternFit * 0.28 + shapeFit * 0.22 + spectralFit * 0.14) *
      rewardBoost *
      sampleDepth *
      electrodePenalty
  );
  const anomalyScore = clamp(profile.count >= MIN_PROFILE_WINDOWS ? robustDistance / 4.2 : 0.5 + robustDistance / 10);
  const stabilityScore = clamp((1 - anomalyScore) * 0.55 + confidence * 0.35 + profile.qualityOkRatio * 0.1);
  const signedRmsZ = signedRobustZ(snapshot.rms, profile.stats.rms);
  const signedP2pZ = signedRobustZ(snapshot.p2p, profile.stats.p2p);
  const positiveAmplitude = clamp((Math.max(0, signedRmsZ) * 0.55 + Math.max(0, signedP2pZ) * 0.45) / 4);
  const spectralStress = clamp(snapshot.energy.low * 0.45 + snapshot.energy.mid * 0.25 + Math.max(0, z.lowRatio - z.highRatio) / 8);
  const responsePrior = 0.35 + profile.responseReward * 0.65;
  const stressScore = clamp(
    (positiveAmplitude * 0.42 + spectralStress * 0.24 + clamp(z.slope / 5) * 0.18 + clamp(z.spikeRate / 5) * 0.16) *
      responsePrior *
      (0.55 + confidence * 0.45)
  );
  const rhythmScore = clamp(
    (shapeFit * 0.38 +
      (1 - anomalyScore) * 0.24 +
      snapshot.energy.mid * 0.18 +
      (1 - clamp(z.turningRate / 4)) * 0.12 +
      confidence * 0.08) *
      (profile.count >= MIN_PROFILE_WINDOWS ? 1 : 0.55)
  );

  let activityIndex: number | null = null;
  if (rms != null && baselineRms != null && baselineRms > 0) {
    const rmsActivity = clamp(rms / (baselineRms * BIO_CONFIG.activitySaturationFactor));
    const p2pBaseline = profile.stats.p2p.median > 0 ? profile.stats.p2p.median : null;
    const p2pActivity =
      snapshot.p2p != null && p2pBaseline != null
        ? clamp(snapshot.p2p / (p2pBaseline * BIO_CONFIG.activitySaturationFactor))
        : rmsActivity;
    const burstActivity = clamp(Math.max(0, signedRobustZ(snapshot.spikeRate, profile.stats.spikeRate)) / 5);
    const rawActivity = clamp(rmsActivity * 0.68 + p2pActivity * 0.2 + burstActivity * 0.12);
    const artifactPenalty = clamp(1 - Math.max(0, z.highRatio - 2.5) * 0.08 - (reading.qualityFlag === "noisy" ? 0.12 : 0));
    const denoised = (confidence * rawActivity + (1 - confidence) * profile.activityPrior) * artifactPenalty;
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
    pattern: classifyPattern(reading, confidence, profile, z, snapshot, anomalyScore, stressScore, rhythmScore),
    anomalyScore: round3(anomalyScore),
    stressScore: round3(stressScore),
    rhythmScore: round3(rhythmScore),
    stabilityScore: round3(stabilityScore),
    spectralBalance: {
      low: round3(snapshot.energy.low),
      mid: round3(snapshot.energy.mid),
      high: round3(snapshot.energy.high),
      entropy: round3(snapshot.energy.entropy),
    },
    reasons: explainSignal(z, snapshot, profile, similarity),
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
      orderBy: { recordedAt: "desc" },
      take: MAX_HISTORY,
    }),
    prisma.bioResponseEvent.findMany({
      where: { plantId },
      orderBy: { eventAt: "desc" },
      take: 30,
    }),
  ]);
  const profile = learnProfile([...history].reverse(), responses, fallbackBaseline);
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
