import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { extractFeatures } from "@/lib/ml/features"
import { predict } from "@/lib/ml/model"
import { onlineUpdate } from "@/lib/ml/online"
import { sensorDerivedLabel } from "@/lib/ml/labels"
import { FEATURE_SCHEMA_VERSION } from "@/lib/ml/featureVector"
import { DEFAULT_WEIGHTS, type ModelWeights, type TrainingSample } from "@/lib/ml/types"
import { mlCollectSchema } from "@/lib/schemas"

const bodySchema = mlCollectSchema

// How many recent samples feed the real-time online refinement step.
const ONLINE_BUFFER = 80

type ActiveVersion = { id: string; weights: ModelWeights; metrics: Record<string, unknown> }

async function getActiveVersion(): Promise<ActiveVersion | null> {
  const active = await prisma.mLModelVersion.findFirst({
    where: { isActive: true },
    orderBy: { trainedAt: "desc" }
  })
  if (!active) return null
  let weights: ModelWeights = DEFAULT_WEIGHTS
  let metrics: Record<string, unknown> = {}
  try { weights = JSON.parse(active.weights) as ModelWeights } catch {}
  try {
    const m = active.metrics ? JSON.parse(active.metrics) : {}
    if (m && typeof m === "object") metrics = m as Record<string, unknown>
  } catch {}
  return { id: active.id, weights, metrics }
}

/**
 * Real-time refinement: nudge the active model toward the most recent labeled
 * samples. The online learner self-gates (it rolls back if it doesn't help), so
 * this is safe to run on every collection. Returns whether weights changed.
 */
async function refineOnline(plantId: string | undefined): Promise<{ applied: boolean; errorBefore?: number; errorAfter?: number }> {
  const active = await getActiveVersion()
  if (!active) return { applied: false }

  const recent = await prisma.mLTrainingSample.findMany({
    where: plantId ? { plantId } : {},
    orderBy: { sampledAt: "desc" },
    take: ONLINE_BUFFER
  })
  const buffer: TrainingSample[] = recent.flatMap((s: { features: string; label: number; plantId: string; sampledAt: Date; photoId: string | null }) => {
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

  const result = onlineUpdate(active.weights, buffer)
  if (!result.applied) return { applied: false, errorBefore: result.errorBefore, errorAfter: result.errorAfter }

  const onlineSteps = (typeof active.metrics.onlineSteps === "number" ? active.metrics.onlineSteps : 0) + 1
  await prisma.mLModelVersion.update({
    where: { id: active.id },
    data: {
      weights: JSON.stringify(result.weights),
      metrics: JSON.stringify({
        ...active.metrics,
        onlineSteps,
        onlineErrorBefore: result.errorBefore,
        onlineErrorAfter: result.errorAfter,
        lastOnlineAt: new Date().toISOString()
      })
    }
  })
  return { applied: true, errorBefore: result.errorBefore, errorAfter: result.errorAfter }
}

async function getActiveWeights(): Promise<ModelWeights> {
  const active = await getActiveVersion()
  return active?.weights ?? DEFAULT_WEIGHTS
}

export async function POST(req: Request) {
  const start = Date.now()
  const body = await req.json().catch(() => ({}))
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides" }, { status: 400 })

  const { plantId, includeSensorDerived = false } = parsed.data

  const photos = await prisma.plantPhoto.findMany({
    where: {
      ...(plantId ? { plantId } : {}),
      healthScore: { not: null },
      confidence: { gt: 0.3 }
    },
    orderBy: { createdAt: "asc" }
  })

  if (photos.length === 0) {
    return NextResponse.json({ created: 0, message: "Aucune photo avec score de santé trouvée" })
  }

  const weights = await getActiveWeights()
  let created = 0
  let skipped = 0

  for (const photo of photos) {
    // Skip if sample already exists for this photo
    const existing = await prisma.mLTrainingSample.findFirst({
      where: { photoId: photo.id }
    })
    if (existing) { skipped++; continue }

    const photoTime = new Date(photo.takenAt ?? photo.createdAt)

    const plant = await prisma.plant.findUnique({
      where: { id: photo.plantId },
      include: {
        // Readings from ±12h window around photo time
        readings: {
          where: {
            recordedAt: {
              gte: new Date(photoTime.getTime() - 12 * 3_600_000),
              lte: new Date(photoTime.getTime() + 12 * 3_600_000)
            }
          },
          orderBy: { recordedAt: "desc" },
          take: 48
        },
        alerts: {
          where: {
            createdAt: { lte: photoTime },
            status: "open"
          },
          take: 20
        }
      }
    })
    if (!plant) continue

    // For training samples: zero out photo cluster to avoid circular labels
    // (we want the model to learn sensor+weather+LLM → health, not photo → health)
    const features = extractFeatures(
      plant,
      plant.readings,
      null,  // no weather at training time (would need historical data)
      [],    // empty photos — avoid circular dependency with label
      [],    // no cached insights for historical samples
      plant.alerts,
      photoTime
    )

    const prediction = predict(features, weights)

    await prisma.mLTrainingSample.create({
      data: {
        plantId: photo.plantId,
        sampledAt: photoTime,
        features: JSON.stringify(features),
        label: photo.healthScore!,
        labelSource: "photo",
        featureSchemaVersion: FEATURE_SCHEMA_VERSION,
        photoId: photo.id,
        prediction: prediction.healthScore
      }
    })
    created++
  }

  // Optionnel: étiquetage dérivé capteurs pour élargir la couverture des plantes
  // peu/pas photographiées. Confiance basse + désactivé par défaut (anti-circularité).
  let sensorDerived = 0
  if (includeSensorDerived) {
    sensorDerived = await collectSensorDerived(plantId, weights)
  }

  // Real-time online refinement on the freshly enlarged sample set.
  const online = created + sensorDerived > 0 ? await refineOnline(plantId) : { applied: false }

  console.log(JSON.stringify({ route: "POST /api/ml/collect", plantId, created, sensorDerived, skipped, onlineApplied: online.applied, latencyMs: Date.now() - start, status: 200 }))
  return NextResponse.json({
    created,
    sensorDerived,
    skipped,
    total: photos.length,
    online,
    message: `${created} échantillons photo${sensorDerived ? ` + ${sensorDerived} capteurs` : ""}, ${skipped} déjà existants${online.applied ? " — modèle affiné en temps réel" : ""}`
  })
}

const SENSOR_DERIVED_WINDOW_MS = 12 * 3_600_000

/**
 * Crée des échantillons `sensor_derived` pour les plantes ayant des relevés mais
 * pas de photo notée récente. Un échantillon par plante, à l'instant de son
 * dernier relevé, en sautant les fenêtres déjà couvertes par une photo (±12h).
 */
async function collectSensorDerived(plantId: string | undefined, weights: ModelWeights): Promise<number> {
  const plants = await prisma.plant.findMany({
    where: plantId ? { id: plantId } : {},
    include: {
      readings: { orderBy: { recordedAt: "desc" }, take: 48 },
      alerts: { where: { status: "open" }, take: 20 }
    }
  })

  let created = 0
  for (const plant of plants) {
    const latest = plant.readings[0]
    if (!latest) continue
    const sampledAt = new Date(latest.recordedAt)

    // Sauter si une photo couvre déjà cette fenêtre (évite de doubler un label photo).
    const nearbyPhoto = await prisma.plantPhoto.findFirst({
      where: {
        plantId: plant.id,
        healthScore: { not: null },
        createdAt: {
          gte: new Date(sampledAt.getTime() - SENSOR_DERIVED_WINDOW_MS),
          lte: new Date(sampledAt.getTime() + SENSOR_DERIVED_WINDOW_MS)
        }
      }
    })
    if (nearbyPhoto) continue

    // Idempotence: ne pas recréer un échantillon capteur pour la même fenêtre.
    const existing = await prisma.mLTrainingSample.findFirst({
      where: {
        plantId: plant.id,
        labelSource: "sensor_derived",
        sampledAt: {
          gte: new Date(sampledAt.getTime() - SENSOR_DERIVED_WINDOW_MS),
          lte: new Date(sampledAt.getTime() + SENSOR_DERIVED_WINDOW_MS)
        }
      }
    })
    if (existing) continue

    const features = extractFeatures(plant, plant.readings, null, [], [], plant.alerts, sampledAt)
    const { label } = sensorDerivedLabel(features)
    const prediction = predict(features, weights)

    await prisma.mLTrainingSample.create({
      data: {
        plantId: plant.id,
        sampledAt,
        features: JSON.stringify(features),
        label,
        labelSource: "sensor_derived",
        featureSchemaVersion: FEATURE_SCHEMA_VERSION,
        prediction: prediction.healthScore
      }
    })
    created++
  }
  return created
}
