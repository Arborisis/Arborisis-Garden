import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { analyzePlantPhotoWithOpenRouter } from "@/lib/openrouter";
import {
  createPhotoObjectKey,
  deletePlantPhotoObject,
  parseImageDataUrl,
  uploadPlantPhotoObject
} from "@/lib/photo-storage";
import { plantPhotoCreateSchema, plantPhotoDeleteSchema, plantPhotoQuerySchema } from "@/lib/schemas";
import { extractFeatures } from "@/lib/ml/features";
import { predict } from "@/lib/ml/model";
import { DEFAULT_WEIGHTS, type ModelWeights } from "@/lib/ml/types";

export const runtime = "nodejs";

function parseJsonArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function serializePhoto(photo: {
  id: string;
  title: string;
  mimeType: string;
  sizeBytes: number;
  takenAt: Date | null;
  analysis: string;
  observations: string;
  recommendations: string;
  healthScore: number | null;
  confidence: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...photo,
    imageUrl: `/api/photos/image?id=${photo.id}&v=${photo.updatedAt.getTime()}`,
    observations: parseJsonArray(photo.observations),
    recommendations: parseJsonArray(photo.recommendations)
  };
}

export async function GET(request: NextRequest) {
  const query = plantPhotoQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  const photos = await prisma.plantPhoto.findMany({
    where: { plantId: query.plantId },
    orderBy: { createdAt: "desc" },
    take: 24
  });

  return NextResponse.json({ photos: photos.map(serializePhoto) });
}

export async function POST(request: NextRequest) {
  const body = plantPhotoCreateSchema.parse(await request.json());
  const plant = await prisma.plant.findUniqueOrThrow({
    where: { id: body.plantId },
    include: {
      readings: { orderBy: { recordedAt: "desc" }, take: 1 }
    }
  });

  const image = parseImageDataUrl(body.imageDataUrl);
  const objectKey = createPhotoObjectKey(plant.id, image.mimeType);
  await uploadPlantPhotoObject({
    objectKey,
    mimeType: image.mimeType,
    bytes: image.bytes
  });

  const latest = plant.readings[0];
  const plantContext = [
    `Plante: ${plant.name}`,
    `Espece: ${plant.species ?? "non specifiee"}`,
    `Lieu: ${plant.location ?? "non specifie"}`,
    `Notes: ${plant.notes ?? "aucune"}`,
    latest
      ? `Derniere mesure: humidite sol ${latest.soilMoisturePct ?? "N/A"}%, sol ${latest.soilTempC ?? "N/A"}C, air ${latest.airTempC ?? "N/A"}C, lumiere ${latest.lightLux ?? "N/A"} lux`
      : "Aucune mesure capteur recente"
  ].join("\n");

  const analysis = await analyzePlantPhotoWithOpenRouter({
    imageDataUrl: body.imageDataUrl,
    plantContext,
    title: body.title
  }).catch((error) => ({
    summary: error instanceof Error ? error.message : "Analyse photo indisponible.",
    observations: [],
    recommendations: ["Relancer l'analyse lorsque OpenRouter est disponible."],
    healthScore: null,
    confidence: 0
  }));

  const photo = await prisma.plantPhoto.create({
    data: {
      plantId: plant.id,
      title: body.title?.trim() || `Photo du ${new Date().toLocaleDateString("fr-BE")}`,
      objectKey,
      mimeType: image.mimeType,
      sizeBytes: image.bytes.length,
      takenAt: body.takenAt ? new Date(body.takenAt) : null,
      analysis: analysis.summary,
      observations: JSON.stringify(analysis.observations),
      recommendations: JSON.stringify(analysis.recommendations),
      healthScore: analysis.healthScore,
      confidence: analysis.confidence
    }
  });

  if (analysis.summary) {
    await prisma.memory.create({
      data: {
        plantId: plant.id,
        kind: "sensor_observation",
        content: `Photo "${photo.title}": ${analysis.summary.slice(0, 700)}`
      }
    });
  }

  // Auto-collect ML training sample when photo has a health score
  if (photo.healthScore != null && photo.confidence > 0.3) {
    const photoTime = photo.takenAt ?? photo.createdAt
    prisma.plant.findUnique({
      where: { id: plant.id },
      include: {
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
        alerts: { where: { status: "open" }, take: 20 }
      }
    }).then(async (plantWithData) => {
      if (!plantWithData) return
      const activeModel = await prisma.mLModelVersion.findFirst({
        where: { isActive: true },
        orderBy: { trainedAt: "desc" }
      })
      const weights: ModelWeights = activeModel
        ? JSON.parse(activeModel.weights)
        : DEFAULT_WEIGHTS
      const features = extractFeatures(
        plantWithData,
        plantWithData.readings,
        null,
        [],
        [],
        plantWithData.alerts,
        photoTime
      )
      const prediction = predict(features, weights)
      await prisma.mLTrainingSample.create({
        data: {
          plantId: plant.id,
          sampledAt: photoTime,
          features: JSON.stringify(features),
          label: photo.healthScore!,
          labelSource: "photo",
          photoId: photo.id,
          prediction: prediction.healthScore
        }
      })
    }).catch(() => undefined)
  }

  return NextResponse.json({ photo: serializePhoto(photo) });
}

export async function DELETE(request: NextRequest) {
  const body = plantPhotoDeleteSchema.parse(await request.json());
  const photo = await prisma.plantPhoto.findUniqueOrThrow({ where: { id: body.id } });

  await deletePlantPhotoObject(photo.objectKey).catch(() => undefined);
  await prisma.plantPhoto.delete({ where: { id: body.id } });

  return NextResponse.json({ ok: true });
}
