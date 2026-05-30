import type { MLFeatures } from "./types"

function c100(v: number): number {
  return Math.max(0, Math.min(100, v))
}

export function computeSensorScore(f: MLFeatures): number {
  // Moisture: penalize deviation from target (dryness hurts more than overwatering)
  const dryPenalty = Math.max(0, f.targetMoisturePct - f.currentMoisturePct) /
    Math.max(f.targetMoisturePct, 1)
  const wetPenalty = Math.max(0, f.currentMoisturePct - f.targetMoisturePct) /
    Math.max(100 - f.targetMoisturePct, 1) * 0.5
  const moistureBase = c100(100 - dryPenalty * 120 - wetPenalty * 60)

  // Extra penalty if trending down fast while already below target
  const trendPenalty =
    f.moistureSlopePctPerHour < -0.5 && f.currentMoisturePct < f.targetMoisturePct
      ? Math.min(20, Math.abs(f.moistureSlopePctPerHour) * 4)
      : 0
  const moistureScore = c100(moistureBase - trendPenalty)

  const tempScore = c100(f.soilTempScore * 100)
  const lightScore = c100(f.lightRatio * 100)
  const stabilityScore = c100(100 - f.moistureVolatility * 80)

  return c100(
    moistureScore * 0.35 +
    tempScore * 0.25 +
    lightScore * 0.25 +
    stabilityScore * 0.15
  )
}

export function computeWeatherRisk(f: MLFeatures): number {
  const et0Risk = f.et0Norm * 70
  const tempStress = f.weatherTempNorm > 0.8
    ? (f.weatherTempNorm - 0.8) * 250
    : f.weatherTempNorm < 0.2
    ? (0.2 - f.weatherTempNorm) * 150
    : 0
  const uvStress = f.uvNorm * 25
  const windowRisk = (1 - f.wateringWindowScore) * 30
  const rainBonus = f.rainProbability * 25

  return c100(et0Risk * 0.35 + tempStress * 0.25 + uvStress * 0.15 + windowRisk * 0.25 - rainBonus)
}

export function computeVisualScore(f: MLFeatures): number {
  if (f.photoFreshness === 0 || f.photoConfidence === 0) return 50
  const reliability = f.photoConfidence * f.photoFreshness
  return c100(f.photoHealth * 100 * reliability + 50 * (1 - reliability))
}

export function computeLlmConsensus(f: MLFeatures): number {
  if (f.insightCoverage === 0) return 60
  return c100(
    f.insightGoodRatio * 90 +
    f.insightWatchRatio * 55 +
    f.insightUrgentRatio * 15
  )
}
