import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { z } from "zod"
import { extractFeatures } from "@/lib/ml/features"
import { predict } from "@/lib/ml/model"
import { DEFAULT_WEIGHTS, type ModelWeights } from "@/lib/ml/types"

const bodySchema = z.object({
  plantId: z.string().optional()
})

async function getActiveWeights(): Promise<ModelWeights> {
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

  const { plantId } = parsed.data

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
        photoId: photo.id,
        prediction: prediction.healthScore
      }
    })
    created++
  }

  console.log(JSON.stringify({ route: "POST /api/ml/collect", plantId, created, skipped, latencyMs: Date.now() - start, status: 200 }))
  return NextResponse.json({
    created,
    skipped,
    total: photos.length,
    message: `${created} échantillons créés, ${skipped} déjà existants`
  })
}
