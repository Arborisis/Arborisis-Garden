import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { trainWeights } from "@/lib/ml/trainer"
import { DEFAULT_WEIGHTS, type ModelWeights, type TrainingSample } from "@/lib/ml/types"

const bodySchema = z.object({
  plantId: z.string().optional(),
  epochs: z.number().int().min(5).max(100).optional()
})

async function getCurrentWeights(): Promise<ModelWeights> {
  const active = await prisma.mLModelVersion.findFirst({
    where: { isActive: true },
    orderBy: { trainedAt: "desc" }
  })
  if (!active) return DEFAULT_WEIGHTS
  try { return JSON.parse(active.weights) as ModelWeights } catch { return DEFAULT_WEIGHTS }
}

export async function POST(req: Request) {
  const start = Date.now()
  const body = await req.json().catch(() => ({}))
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides" }, { status: 400 })

  const { plantId, epochs = 30 } = parsed.data

  const rawSamples = await prisma.mLTrainingSample.findMany({
    where: plantId ? { plantId } : {},
    orderBy: { sampledAt: "asc" }
  })

  if (rawSamples.length < 3) {
    return NextResponse.json(
      {
        error: "Données insuffisantes",
        message: `${rawSamples.length} échantillon(s) disponible(s). Minimum 3 requis. Appelez d'abord /api/ml/collect.`,
        sampleCount: rawSamples.length
      },
      { status: 422 }
    )
  }

  const samples: TrainingSample[] = rawSamples.flatMap(s => {
    try {
      return [{
        features: JSON.parse(s.features),
        label: s.label,
        plantId: s.plantId,
        sampledAt: s.sampledAt.toISOString(),
        photoId: s.photoId ?? ""
      } satisfies TrainingSample]
    } catch {
      return []
    }
  })

  const initialWeights = await getCurrentWeights()
  const result = trainWeights(initialWeights, samples, epochs)

  // Deactivate all previous versions
  await prisma.mLModelVersion.updateMany({ where: {}, data: { isActive: false } })

  const version = `v${Date.now()}`
  const newVersion = await prisma.mLModelVersion.create({
    data: {
      version,
      sampleCount: result.sampleCount,
      weights: JSON.stringify(result.weights),
      metrics: JSON.stringify({ rmse: result.rmse, mae: result.mae, epochs: result.epochs }),
      isActive: true
    }
  })

  // Update prediction errors on samples
  await prisma.mLTrainingSample.updateMany({
    where: plantId ? { plantId } : {},
    data: { prediction: null }
  })

  console.log(JSON.stringify({ route: "POST /api/ml/train", plantId, version: newVersion.version, sampleCount: result.sampleCount, rmse: result.rmse, latencyMs: Date.now() - start, status: 200 }))
  return NextResponse.json({
    version: newVersion.version,
    trainedAt: newVersion.trainedAt,
    sampleCount: result.sampleCount,
    epochs: result.epochs,
    metrics: { rmse: result.rmse, mae: result.mae },
    weights: result.weights,
    previousWeights: initialWeights
  })
}

export async function GET() {
  const versions = await prisma.mLModelVersion.findMany({
    orderBy: { trainedAt: "desc" },
    take: 10
  })
  const sampleCount = await prisma.mLTrainingSample.count()

  return NextResponse.json({
    sampleCount,
    versions: versions.map(v => ({
      version: v.version,
      trainedAt: v.trainedAt,
      sampleCount: v.sampleCount,
      isActive: v.isActive,
      weights: JSON.parse(v.weights),
      metrics: v.metrics ? JSON.parse(v.metrics) : null
    }))
  })
}
