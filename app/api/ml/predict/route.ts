import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { extractFeatures } from "@/lib/ml/features"
import { mixtureWeights, predict } from "@/lib/ml/model"
import { DEFAULT_WEIGHTS, type ModelWeights } from "@/lib/ml/types"
import { getWeatherContext } from "@/lib/weather"
import { getCachedInsights } from "@/lib/insights"


const querySchema = z.object({
  plantId: z.string().min(1),
  weatherLocation: z.string().optional(),
  timezone: z.string().optional()
})

async function getActiveWeights(): Promise<ModelWeights> {
  const active = await prisma.mLModelVersion.findFirst({
    where: { isActive: true },
    orderBy: { trainedAt: "desc" }
  })
  if (!active) return DEFAULT_WEIGHTS
  try {
    return JSON.parse(active.weights) as ModelWeights
  } catch {
    return DEFAULT_WEIGHTS
  }
}

export async function GET(req: Request) {
  const start = Date.now()
  const { searchParams } = new URL(req.url)
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams))
  if (!parsed.success) {
    console.log(JSON.stringify({ route: "GET /api/ml/predict", error: "missing plantId", latencyMs: Date.now() - start, status: 400 }))
    return NextResponse.json({ error: "plantId requis" }, { status: 400 })
  }
  const { plantId, weatherLocation, timezone } = parsed.data

  const plant = await prisma.plant.findUnique({
    where: { id: plantId },
    include: {
      readings: { orderBy: { recordedAt: "desc" }, take: 48 },
      alerts: { where: { status: "open" }, orderBy: { createdAt: "desc" }, take: 20 },
      photos: { orderBy: { createdAt: "desc" }, take: 6 }
    }
  })
  if (!plant) {
    console.log(JSON.stringify({ route: "GET /api/ml/predict", plantId, error: "not found", latencyMs: Date.now() - start, status: 404 }))
    return NextResponse.json({ error: "Plante introuvable" }, { status: 404 })
  }

  const [weather, activeWeights] = await Promise.all([
    weatherLocation
      ? getWeatherContext({ location: weatherLocation, timezone }).catch(() => null)
      : Promise.resolve(null),
    getActiveWeights()
  ])

  // Fetch cached LLM insights (don't trigger new generation here)
  const cachedInsights = await getCachedInsights(prisma, plantId)

  const features = extractFeatures(
    plant,
    plant.readings,
    weather,
    plant.photos,
    cachedInsights,
    plant.alerts
  )

  const prediction = predict(features, activeWeights)

  const modelInfo = await prisma.mLModelVersion.findFirst({
    where: { isActive: true },
    select: { version: true, trainedAt: true, sampleCount: true }
  })

  console.log(JSON.stringify({ route: "GET /api/ml/predict", plantId, confidenceScore: prediction.confidenceScore, latencyMs: Date.now() - start, status: 200 }))
  return NextResponse.json({
    prediction,
    features: {
      sensorFreshness: features.sensorFreshness,
      moisturePct: features.currentMoisturePct,
      targetMoisturePct: features.targetMoisturePct,
      moistureSlopePctPerHour: features.moistureSlopePctPerHour,
      photoHealth: features.photoHealth,
      photoConfidence: features.photoConfidence,
      photoColorAnomalyScore: features.photoColorAnomalyScore,
      photoColorAnomalyConfidence: features.photoColorAnomalyConfidence,
      photoSpotCountNorm: features.photoSpotCountNorm,
      photoDiseaseRisk: features.photoDiseaseRisk
    },
    modelVersion: modelInfo ?? { version: "default", trainedAt: null, sampleCount: 0 },
    weights: mixtureWeights(activeWeights)
  })
}
