import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { manualLabelSchema } from "@/lib/schemas"
import { isMutationAuthorized } from "@/lib/ml/dataset/auth"
import { extractFeatures } from "@/lib/ml/features"
import { predict } from "@/lib/ml/model"
import { manualLabel } from "@/lib/ml/labels"
import { FEATURE_SCHEMA_VERSION } from "@/lib/ml/featureVector"
import { DEFAULT_WEIGHTS, type ModelWeights } from "@/lib/ml/types"

export const runtime = "nodejs"

async function getActiveWeights(): Promise<ModelWeights> {
  const active = await prisma.mLModelVersion.findFirst({
    where: { isActive: true },
    orderBy: { trainedAt: "desc" }
  })
  if (!active) return DEFAULT_WEIGHTS
  try { return JSON.parse(active.weights) as ModelWeights } catch { return DEFAULT_WEIGHTS }
}

/**
 * POST — correction manuelle: crée un échantillon d'entraînement `manual` (vérité
 * terrain) pour une plante à un instant donné. Features extraites comme en collecte
 * (photos vides → pas de fuite du label visuel). Token-gated.
 */
export async function POST(req: Request) {
  const start = Date.now()
  if (!isMutationAuthorized(req)) {
    return NextResponse.json({ error: "Token device invalide" }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))
  const parsed = manualLabelSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides", issues: parsed.error.issues }, { status: 400 })

  const { plantId, value } = parsed.data
  const sampledAt = parsed.data.sampledAt ? new Date(parsed.data.sampledAt) : new Date()

  const plant = await prisma.plant.findUnique({
    where: { id: plantId },
    include: {
      readings: {
        where: {
          recordedAt: {
            gte: new Date(sampledAt.getTime() - 12 * 3_600_000),
            lte: new Date(sampledAt.getTime() + 12 * 3_600_000)
          }
        },
        orderBy: { recordedAt: "desc" },
        take: 48
      },
      alerts: { where: { createdAt: { lte: sampledAt }, status: "open" }, take: 20 }
    }
  })
  if (!plant) return NextResponse.json({ error: "Plante introuvable" }, { status: 404 })

  const features = extractFeatures(plant, plant.readings, null, [], [], plant.alerts, sampledAt)
  const { label } = manualLabel(value)
  const weights = await getActiveWeights()
  const prediction = predict(features, weights)

  const sample = await prisma.mLTrainingSample.create({
    data: {
      plantId,
      sampledAt,
      features: JSON.stringify(features),
      label,
      labelSource: "manual",
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      prediction: prediction.healthScore
    }
  })

  console.log(JSON.stringify({ route: "POST /api/ml/label", plantId, label, latencyMs: Date.now() - start, status: 200 }))
  return NextResponse.json({ id: sample.id, plantId, label, labelSource: "manual", sampledAt })
}
