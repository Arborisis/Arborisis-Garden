import type { MLFeatures, MLPrediction, ModelWeights } from "./types"
import { DEFAULT_WEIGHTS } from "./types"
import {
  computeSensorScore,
  computeWeatherRisk,
  computeVisualScore,
  computeLlmConsensus
} from "./scoring"

export function predict(
  features: MLFeatures,
  weights: ModelWeights = DEFAULT_WEIGHTS
): MLPrediction {
  const sensorScore = computeSensorScore(features)
  const visualScore = computeVisualScore(features)
  const weatherRisk = computeWeatherRisk(features)
  const llmConsensus = computeLlmConsensus(features)

  const rawScore =
    sensorScore * weights.sensor +
    visualScore * weights.visual +
    (100 - weatherRisk) * weights.weather +
    llmConsensus * weights.llm

  const alertPenalty = features.hasCriticalAlert * 15 + features.openAlertCountNorm * 10
  const healthScore = Math.max(0, Math.min(100, rawScore - alertPenalty))

  // Confidence reflects how much real data we have
  const sensorCoverage = features.sensorFreshness * (1 - Math.min(1, features.moistureDeviation))
  const photoCoverage = features.photoFreshness * features.photoConfidence
  const confidenceScore =
    Math.round(Math.min(1, sensorCoverage * 0.5 + photoCoverage * 0.3 + features.insightCoverage * 0.2) * 100) / 100

  const stressLevel =
    healthScore >= 75 ? 'healthy'
    : healthScore >= 55 ? 'watch'
    : healthScore >= 35 ? 'moderate_stress'
    : 'critical'

  // Watering urgency prediction via linear extrapolation
  let wateringUrgencyHours: number | null = null
  const { currentMoisturePct, targetMoisturePct, moistureSlopePctPerHour } = features
  const criticalThreshold = Math.max(targetMoisturePct * 0.5, 20)
  if (currentMoisturePct <= criticalThreshold) {
    wateringUrgencyHours = 0
  } else if (moistureSlopePctPerHour < -0.3) {
    const hours = (currentMoisturePct - criticalThreshold) / Math.abs(moistureSlopePctPerHour)
    if (hours > 0 && hours <= 72) {
      wateringUrgencyHours = Math.round(hours)
    }
  }

  // Top 3 clusters by absolute deviation from neutral (50)
  const clusters: [string, number][] = [
    ['Humidité sol', sensorScore * weights.sensor],
    ['Analyse visuelle', visualScore * weights.visual],
    ['Météo', (100 - weatherRisk) * weights.weather],
    ['Intelligence LLM', llmConsensus * weights.llm]
  ]
  const dominantSignals = [...clusters]
    .sort((a, b) => Math.abs(b[1] - 50) - Math.abs(a[1] - 50))
    .slice(0, 3)
    .map(([name]) => name)

  return {
    healthScore: Math.round(healthScore),
    stressLevel,
    wateringUrgencyHours,
    confidenceScore,
    breakdown: {
      sensorScore: Math.round(sensorScore),
      visualScore: Math.round(visualScore),
      weatherRisk: Math.round(weatherRisk),
      llmConsensus: Math.round(llmConsensus)
    },
    dominantSignals,
    generatedAt: new Date().toISOString()
  }
}
