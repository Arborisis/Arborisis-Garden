import type { Plant, Reading, PlantPhoto, Alert } from "@prisma/client"
import type { WeatherContext } from "@/lib/weather"
import type { AiInsight } from "@/lib/insights"
import type { MLFeatures } from "./types"

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v))
}

function linearSlope(times: number[], values: number[]): number {
  const n = values.length
  if (n < 2) return 0
  const tMean = times.reduce((a, b) => a + b, 0) / n
  const vMean = values.reduce((a, b) => a + b, 0) / n
  let num = 0, den = 0
  for (let i = 0; i < n; i++) {
    num += (times[i] - tMean) * (values[i] - vMean)
    den += (times[i] - tMean) ** 2
  }
  return den === 0 ? 0 : num / den
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length)
}

export function extractFeatures(
  plant: Plant,
  readings: Reading[],
  weather: WeatherContext | null,
  photos: PlantPhoto[],
  insights: AiInsight[],
  alerts: Alert[],
  asOf?: Date
): MLFeatures {
  const now = asOf?.getTime() ?? Date.now()

  const sorted = [...readings].sort(
    (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime()
  )
  const last12h = sorted.filter(r => now - new Date(r.recordedAt).getTime() < 12 * 3_600_000)
  const latest = sorted[0]

  // ---- Moisture ----
  const moistureObs = last12h
    .filter(r => r.soilMoisturePct != null)
    .map(r => ({ t: new Date(r.recordedAt).getTime() / 3_600_000, v: r.soilMoisturePct! }))
    .sort((a, b) => a.t - b.t)

  const currentMoisturePct = latest?.soilMoisturePct ?? plant.targetMoisture
  const targetMoisturePct = plant.targetMoisture

  const moistureNormalized = clamp(currentMoisturePct / Math.max(targetMoisturePct, 1) * 0.667)
  const moistureDeviation = Math.abs(currentMoisturePct - targetMoisturePct) / Math.max(targetMoisturePct, 1)

  const moistureSlopePctPerHour = moistureObs.length >= 3
    ? linearSlope(moistureObs.map(r => r.t), moistureObs.map(r => r.v))
    : 0
  const moistureTrendNorm = clamp((moistureSlopePctPerHour + 5) / 10)
  const moistureVolatility = clamp(stdDev(moistureObs.map(r => r.v)) / 20)

  // ---- Temperature ----
  const soilTempC = latest?.soilTempC ?? (plant.minSoilTempC + plant.maxSoilTempC) / 2
  const tempMid = (plant.minSoilTempC + plant.maxSoilTempC) / 2
  const tempHalfRange = (plant.maxSoilTempC - plant.minSoilTempC) / 2
  const soilTempScore = clamp(1 - Math.max(0, Math.abs(soilTempC - tempMid) - tempHalfRange) / 5)

  const airTempC = latest?.airTempC ?? 20
  const airTempNorm = clamp((airTempC - 5) / 35)
  const airHumidityNorm = clamp((latest?.airHumidityPct ?? 60) / 100)

  // ---- Light ----
  const lightLux = latest?.lightLux ?? 0
  const lightRatio = clamp(lightLux / Math.max(plant.minLightLux, 1))

  const lightObs = last12h
    .filter(r => r.lightLux != null)
    .map(r => ({ t: new Date(r.recordedAt).getTime() / 3_600_000, v: r.lightLux! }))
    .sort((a, b) => a.t - b.t)
  const lightSlope = lightObs.length >= 3
    ? linearSlope(lightObs.map(r => r.t), lightObs.map(r => r.v))
    : 0
  const lightTrendNorm = clamp((lightSlope + 100) / 200)

  // ---- Sensor freshness ----
  const gapMs = latest ? now - new Date(latest.recordedAt).getTime() : 48 * 3_600_000
  const sensorFreshness = clamp(Math.exp(-gapMs / (24 * 3_600_000)))

  // ---- Weather ----
  const weatherTempNorm = weather ? clamp(((weather.current.temperatureC ?? 20) - 5) / 35) : airTempNorm
  const weatherHumidityNorm = weather ? clamp((weather.current.humidityPct ?? 60) / 100) : airHumidityNorm
  const rainProbability = weather ? clamp((weather.today.precipitationProbabilityMaxPct ?? 0) / 100) : 0
  const et0Norm = weather ? clamp((weather.today.evapotranspirationMm ?? 0) / 6) : 0.3
  const uvNorm = weather ? clamp((weather.today.uvIndexMax ?? 0) / 12) : 0.3
  const wateringWindowScore = weather
    ? ({ good: 1, careful: 0.5, avoid: 0 } as const)[weather.gardening.wateringWindow]
    : 0.5

  // ---- Photos ----
  const scoredPhotos = [...photos]
    .filter(p => p.healthScore != null)
    .sort((a, b) =>
      new Date(b.takenAt ?? b.createdAt).getTime() - new Date(a.takenAt ?? a.createdAt).getTime()
    )
  const latestPhoto = scoredPhotos[0]

  const photoHealth = latestPhoto ? clamp(latestPhoto.healthScore! / 100) : 0.5
  const photoConfidence = latestPhoto?.confidence ?? 0
  const photoAgeDays = latestPhoto
    ? (now - new Date(latestPhoto.takenAt ?? latestPhoto.createdAt).getTime()) / 86_400_000
    : Infinity
  const photoFreshness = photoAgeDays < Infinity ? clamp(Math.exp(-photoAgeDays / 30)) : 0

  // ---- LLM Insights ----
  const total = insights.length
  const goodCount = insights.filter(i => i.tone === 'good').length
  const watchCount = insights.filter(i => i.tone === 'watch').length
  const urgentCount = insights.filter(i => i.tone === 'urgent').length

  const insightGoodRatio = total > 0 ? goodCount / total : 0.5
  const insightWatchRatio = total > 0 ? watchCount / total : 0.3
  const insightUrgentRatio = total > 0 ? urgentCount / total : 0
  const insightCoverage = clamp(total / 4)

  // ---- Alerts ----
  const openAlerts = alerts.filter(a => a.status === 'open')
  const openAlertCountNorm = clamp(openAlerts.length / 5)
  const hasCriticalAlert = openAlerts.some(a => a.severity === 'critical') ? 1 : 0

  return {
    moistureNormalized,
    moistureDeviation,
    moistureTrendNorm,
    moistureVolatility,
    soilTempScore,
    airTempNorm,
    airHumidityNorm,
    lightRatio,
    lightTrendNorm,
    sensorFreshness,
    weatherTempNorm,
    weatherHumidityNorm,
    rainProbability,
    et0Norm,
    uvNorm,
    wateringWindowScore,
    photoHealth,
    photoConfidence,
    photoFreshness,
    insightGoodRatio,
    insightWatchRatio,
    insightUrgentRatio,
    insightCoverage,
    openAlertCountNorm,
    hasCriticalAlert,
    currentMoisturePct,
    targetMoisturePct,
    moistureSlopePctPerHour
  }
}
