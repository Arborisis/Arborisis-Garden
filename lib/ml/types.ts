export type MLFeatures = {
  // Sensor cluster
  moistureNormalized: number      // currentMoisture / target, capped 0-1
  moistureDeviation: number       // |current - target| / target
  moistureTrendNorm: number       // 0=rapidly falling, 0.5=stable, 1=rising
  moistureVolatility: number      // std dev / 20, 0-1
  soilTempScore: number           // 0-1: 1=ideal range
  airTempNorm: number             // (temp - 5) / 35, 0-1
  airHumidityNorm: number         // humidity / 100
  lightRatio: number              // actual / target, clamped 0-1
  lightTrendNorm: number          // normalized light trend direction
  sensorFreshness: number         // exp(-gapHours/24), 1=fresh

  // Weather cluster
  weatherTempNorm: number
  weatherHumidityNorm: number
  rainProbability: number
  et0Norm: number                 // evapotranspiration / 6mm
  uvNorm: number                  // uvIndex / 12
  wateringWindowScore: number     // 0=avoid, 0.5=careful, 1=good

  // Photo cluster (0.5 prior when no photo)
  photoHealth: number             // healthScore / 100
  photoConfidence: number         // 0-1 confidence
  photoFreshness: number          // exp(-ageDays/30)

  // LLM insights cluster (0.5/0.3/0 priors when no insights)
  insightGoodRatio: number
  insightWatchRatio: number
  insightUrgentRatio: number
  insightCoverage: number         // count / 4 (max insights)

  // Alert cluster
  openAlertCountNorm: number      // count / 5
  hasCriticalAlert: number        // 0 or 1

  // Raw values for scoring and urgency (not used by gradient descent)
  currentMoisturePct: number
  targetMoisturePct: number
  moistureSlopePctPerHour: number
}

export type MLPrediction = {
  healthScore: number
  stressLevel: 'healthy' | 'watch' | 'moderate_stress' | 'critical'
  wateringUrgencyHours: number | null
  confidenceScore: number
  breakdown: {
    sensorScore: number
    visualScore: number
    weatherRisk: number      // 0-100 where 100 = high risk
    llmConsensus: number
  }
  dominantSignals: string[]
  generatedAt: string
}

export type ModelWeights = {
  sensor: number
  visual: number
  weather: number
  llm: number
}

export const DEFAULT_WEIGHTS: ModelWeights = {
  sensor: 0.45,
  visual: 0.30,
  weather: 0.15,
  llm: 0.10
}

export type TrainingSample = {
  features: MLFeatures
  label: number           // 0-100 health score from photo
  plantId: string
  sampledAt: string
  photoId: string
}
