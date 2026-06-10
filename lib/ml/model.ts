import type { MLFeatures, MLPrediction, ModelWeights } from "./types"
import { DEFAULT_WEIGHTS } from "./types"
import { forward, softmaxExperts, migrateWeights } from "./net"

/**
 * Real-time health prediction.
 *
 * Architecture: a learnable softmax mixture over 4 engineered domain experts
 * (sensor / visual / weather / llm), plus an optional learnable residual head
 * (linear or one-hidden-layer MLP) that corrects the prior using the full
 * standardized feature vector. Accepts both legacy v1 and v2 serialized weights.
 */
export function predict(
  features: MLFeatures,
  rawWeights: ModelWeights | unknown = DEFAULT_WEIGHTS
): MLPrediction {
  const weights = migrateWeights(rawWeights)
  const { health, scores, mix, residual } = forward(weights, features)

  const sensorScore = scores.sensor
  const visualScore = scores.visual
  const weatherRisk = 100 - scores.weather
  const llmConsensus = scores.llm
  const bioScore = scores.bio

  const alertPenalty = features.hasCriticalAlert * 15 + features.openAlertCountNorm * 10
  const healthScore = Math.max(0, Math.min(100, health - alertPenalty))

  // Confidence reflects how much real data we have AND how mature the model is.
  const sensorCoverage = features.sensorFreshness * (1 - Math.min(1, features.moistureDeviation))
  const photoCoverage = features.photoFreshness * features.photoConfidence
  const colorCoverage = features.photoFreshness * features.photoColorAnomalyConfidence
  const dataConfidence = Math.min(
    1,
    sensorCoverage * 0.45 + photoCoverage * 0.25 + colorCoverage * 0.1 + features.insightCoverage * 0.2
  )
  const modelMaturity =
    weights.residual.kind === "mlp" ? 1 : weights.residual.kind === "linear" ? 0.85 : 0.7
  // Calibration: si les poids embarquent leur RMSE out-of-fold (meta), la
  // confiance reflète l'erreur de généralisation réellement mesurée. Sans meta
  // (modèle par défaut / ancien), le facteur vaut 1 → comportement inchangé.
  const valRmse = weights.meta?.valRmse
  const errorFactor =
    typeof valRmse === "number" && Number.isFinite(valRmse)
      ? Math.max(0, Math.min(1, 1 - valRmse / 50))
      : 1
  const confidenceScore =
    Math.round(dataConfidence * modelMaturity * (0.7 + 0.3 * errorFactor) * 100) / 100

  const stressLevel =
    healthScore >= 75 ? 'healthy'
    : healthScore >= 55 ? 'watch'
    : healthScore >= 35 ? 'moderate_stress'
    : 'critical'

  // Watering urgency: soil dries roughly exponentially toward a residual floor
  // (evaporation slows as the soil empties), so we extrapolate
  // M(t) = floor + (M0 − floor)·e^(−kt) with k fitted from the current slope.
  // Linear extrapolation systematically under-estimates the remaining time.
  let wateringUrgencyHours: number | null = null
  const { currentMoisturePct, targetMoisturePct, moistureSlopePctPerHour } = features
  const criticalThreshold = Math.max(targetMoisturePct * 0.5, 20)
  const DRY_FLOOR_PCT = 5
  if (currentMoisturePct <= criticalThreshold) {
    wateringUrgencyHours = 0
  } else if (moistureSlopePctPerHour < -0.3) {
    const above = Math.max(currentMoisturePct - DRY_FLOOR_PCT, 1)
    const thresholdAbove = Math.max(criticalThreshold - DRY_FLOOR_PCT, 1)
    const k = Math.abs(moistureSlopePctPerHour) / above
    const hours = Math.log(above / thresholdAbove) / k
    if (hours > 0 && hours <= 72) {
      wateringUrgencyHours = Math.round(hours)
    }
  }

  // Dominant signals: experts ranked by their actual contribution to the blend.
  const clusters: [string, number][] = [
    ['Humidité sol', sensorScore * mix.sensor],
    ['Analyse visuelle', visualScore * mix.visual],
    ['Météo', scores.weather * mix.weather],
    ['Intelligence LLM', llmConsensus * mix.llm],
    ['Bioélectricité', bioScore * mix.bio]
  ]
  const dominantSignals = [...clusters]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name)
  if (Math.abs(residual) >= 5) {
    dominantSignals.unshift(residual > 0 ? 'Correction apprise (+)' : 'Correction apprise (−)')
    dominantSignals.pop()
  }
  if (features.photoColorAnomalyScore * features.photoColorAnomalyConfidence >= 0.2) {
    dominantSignals.unshift('Taches couleur')
    dominantSignals.splice(3)
  }
  if (features.photoDiseaseRisk * features.photoFreshness >= 0.35) {
    dominantSignals.unshift('Maladie détectée (CNN)')
    dominantSignals.splice(3)
  }

  return {
    healthScore: Math.round(healthScore),
    stressLevel,
    wateringUrgencyHours,
    confidenceScore,
    breakdown: {
      sensorScore: Math.round(sensorScore),
      visualScore: Math.round(visualScore),
      weatherRisk: Math.round(weatherRisk),
      llmConsensus: Math.round(llmConsensus),
      bioScore: Math.round(bioScore)
    },
    dominantSignals,
    generatedAt: new Date().toISOString()
  }
}

/** Expose the active mixture weights (post-softmax) for UI/debugging. */
export function mixtureWeights(rawWeights: ModelWeights | unknown) {
  return softmaxExperts(migrateWeights(rawWeights).experts)
}
