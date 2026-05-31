import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { trainWeights } from "@/lib/ml/trainer"
import { mixtureWeights } from "@/lib/ml/model"
import { DEFAULT_WEIGHTS, type ModelWeights, type TrainingSample } from "@/lib/ml/types"

const bodySchema = z.object({
  plantId: z.string().optional(),
  epochs: z.number().int().min(5).max(2000).optional()
})

function safeJsonParse(value: string | null): unknown {
  if (!value) return null
  try { return JSON.parse(value) } catch { return null }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function safeMixtureWeights(rawWeights: string) {
  return mixtureWeights(safeJsonParse(rawWeights) ?? DEFAULT_WEIGHTS)
}

function safeMetrics(rawMetrics: string | null) {
  const parsed = safeJsonParse(rawMetrics)
  if (!isRecord(parsed)) return null
  const rmse = finiteNumber(parsed.rmse)
  const mae = finiteNumber(parsed.mae)
  if (rmse === undefined || mae === undefined) return null

  return {
    rmse,
    mae,
    valRmse: finiteNumber(parsed.valRmse),
    epochs: finiteNumber(parsed.epochs),
    residualKind: typeof parsed.residualKind === "string" ? parsed.residualKind : undefined,
    adopted: typeof parsed.adopted === "boolean" ? parsed.adopted : undefined
  }
}

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

  const { plantId, epochs = 300 } = parsed.data

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
      metrics: JSON.stringify({
        rmse: result.rmse,
        mae: result.mae,
        valRmse: result.valRmse,
        epochs: result.epochs,
        residualKind: result.residualKind,
        adopted: result.adopted
      }),
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
    metrics: {
      rmse: result.rmse,
      mae: result.mae,
      valRmse: result.valRmse,
      residualKind: result.residualKind,
      adopted: result.adopted
    },
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
      weights: safeMixtureWeights(v.weights),
      metrics: safeMetrics(v.metrics)
    }))
  })
}
