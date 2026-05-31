import type { MLFeatures } from "./types"

/**
 * Ordered list of the learnable, normalized (0-1) features fed to the residual
 * head. Raw values (currentMoisturePct, targetMoisturePct, moistureSlope) are
 * intentionally excluded — they live on different scales and are only used by
 * the engineered scorers / urgency logic.
 *
 * The 4 engineered expert scores are appended at vectorize time (see toVector),
 * so the residual head can also reason over the domain priors themselves.
 */
export const FEATURE_KEYS: (keyof MLFeatures)[] = [
  "moistureNormalized",
  "moistureDeviation",
  "moistureTrendNorm",
  "moistureVolatility",
  "soilTempScore",
  "airTempNorm",
  "airHumidityNorm",
  "lightRatio",
  "lightTrendNorm",
  "sensorFreshness",
  "weatherTempNorm",
  "weatherHumidityNorm",
  "rainProbability",
  "et0Norm",
  "uvNorm",
  "wateringWindowScore",
  "photoHealth",
  "photoConfidence",
  "photoFreshness",
  "photoColorAnomalyScore",
  "photoColorAnomalyConfidence",
  "photoSpotCountNorm",
  "photoDiseaseRisk",
  "insightGoodRatio",
  "insightWatchRatio",
  "insightUrgentRatio",
  "insightCoverage",
  "openAlertCountNorm",
  "hasCriticalAlert"
]

/** Number of appended engineered expert scores (sensor, visual, weather, llm). */
export const EXPERT_FEATURE_COUNT = 4

/** Total input dimension of the residual head. */
export const INPUT_DIM = FEATURE_KEYS.length + EXPERT_FEATURE_COUNT

/**
 * Build the residual-head input vector: the normalized features followed by the
 * 4 engineered expert scores (each rescaled to 0-1).
 */
export function toVector(
  f: MLFeatures,
  experts: { sensor: number; visual: number; weather: number; llm: number }
): number[] {
  const base = FEATURE_KEYS.map(k => {
    const v = f[k]
    return typeof v === "number" && Number.isFinite(v) ? v : 0
  })
  base.push(
    experts.sensor / 100,
    experts.visual / 100,
    experts.weather / 100,
    experts.llm / 100
  )
  return base
}

/** Per-feature mean/std used to standardize the residual input. */
export type NormStats = { mean: number[]; std: number[] }

export function identityNorm(): NormStats {
  return { mean: new Array(INPUT_DIM).fill(0), std: new Array(INPUT_DIM).fill(1) }
}

/** Compute mean/std over a set of vectors (std floored to avoid blow-ups). */
export function fitNorm(vectors: number[][]): NormStats {
  const n = vectors.length
  const mean = new Array(INPUT_DIM).fill(0)
  const std = new Array(INPUT_DIM).fill(1)
  if (n === 0) return { mean, std }

  for (const v of vectors) {
    for (let j = 0; j < INPUT_DIM; j++) mean[j] += v[j]
  }
  for (let j = 0; j < INPUT_DIM; j++) mean[j] /= n

  for (const v of vectors) {
    for (let j = 0; j < INPUT_DIM; j++) {
      const d = v[j] - mean[j]
      std[j] += d * d
    }
  }
  for (let j = 0; j < INPUT_DIM; j++) {
    std[j] = Math.max(Math.sqrt(std[j] / n), 1e-3)
  }
  return { mean, std }
}

export function standardize(v: number[], norm: NormStats): number[] {
  const out = new Array(v.length)
  for (let j = 0; j < v.length; j++) {
    out[j] = (v[j] - (norm.mean[j] ?? 0)) / (norm.std[j] ?? 1)
  }
  return out
}
