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
import {
  analyzePlantColorAnomalies,
  emptyColorAnomalyReport,
  mergeColorAnomalyReports
} from "@/lib/ml/colorAnomaly";

export const runtime = "nodejs";

function parseJsonArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseJsonValue<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
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
  colorTags: string;
  colorAnomalyScore: number;
  colorAnomalyConfidence: number;
  colorFindings: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...photo,
    imageUrl: `/api/photos/image?id=${photo.id}&v=${photo.updatedAt.getTime()}`,
    observations: parseJsonArray(photo.observations),
    recommendations: parseJsonArray(photo.recommendations),
    colorTags: parseJsonArray(photo.colorTags),
    colorFindings: parseJsonValue(photo.colorFindings, [])
  };
}

type PhotoForTrainingSample = {
  id: string;
  healthScore: number | null;
  confidence: number;
  takenAt: Date | null;
  createdAt: Date;
};

async function collectTrainingSampleFromPhoto(plantId: string, photo: PhotoForTrainingSample) {
  if (photo.healthScore == null || photo.confidence <= 0.3) return;

  const photoTime = photo.takenAt ?? photo.createdAt;
  const plantWithData = await prisma.plant.findUnique({
    where: { id: plantId },
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
  });
  if (!plantWithData) return;

  const activeModel = await prisma.mLModelVersion.findFirst({
    where: { isActive: true },
    orderBy: { trainedAt: "desc" }
  });
  const weights: ModelWeights = activeModel
    ? JSON.parse(activeModel.weights)
    : DEFAULT_WEIGHTS;
  const features = extractFeatures(
    plantWithData,
    plantWithData.readings,
    null,
    [],
    [],
    plantWithData.alerts,
    photoTime
  );
  const prediction = predict(features, weights);

  await prisma.mLTrainingSample.create({
    data: {
      plantId,
      sampledAt: photoTime,
      features: JSON.stringify(features),
      label: photo.healthScore,
      labelSource: "photo",
      photoId: photo.id,
      prediction: prediction.healthScore
    }
  });
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
  const submittedImages = body.images?.length
    ? body.images
    : [{ imageDataUrl: body.imageDataUrl!, title: body.title, takenAt: body.takenAt }];
  const plant = await prisma.plant.findUniqueOrThrow({
    where: { id: body.plantId },
    include: {
      readings: { orderBy: { recordedAt: "desc" }, take: 1 }
    }
  });

  const dateLabel = new Date().toLocaleDateString("fr-BE");
  const batchTitle = body.title?.trim()
    || (submittedImages.length === 1 ? submittedImages[0].title?.trim() : "")
    || `Analyse ${submittedImages.length} vues`;
  const preparedImageInputs = submittedImages.map((item, index) => {
    const image = parseImageDataUrl(item.imageDataUrl);
    const title = item.title?.trim()
      || (body.title?.trim()
        ? `${body.title.trim()} - vue ${index + 1}`
        : submittedImages.length > 1
          ? `Vue ${index + 1} du ${dateLabel}`
          : `Photo du ${dateLabel}`);

    return {
      imageDataUrl: item.imageDataUrl,
      title,
      takenAt: item.takenAt,
      objectKey: createPhotoObjectKey(plant.id, image.mimeType),
      mimeType: image.mimeType,
      bytes: image.bytes
    };
  });
  const preparedImages = await Promise.all(preparedImageInputs.map(async (image, index) => ({
    ...image,
    colorReport: await analyzePlantColorAnomalies({
      bytes: image.bytes,
      view: `Vue ${index + 1}`
    }).catch(() => emptyColorAnomalyReport())
  })));
  const colorAnomalyReport = mergeColorAnomalyReports(preparedImages.map((image) => image.colorReport));

  const uploadedObjectKeys: string[] = [];
  try {
    for (const image of preparedImages) {
      await uploadPlantPhotoObject({
        objectKey: image.objectKey,
        mimeType: image.mimeType,
        bytes: image.bytes
      });
      uploadedObjectKeys.push(image.objectKey);
    }
  } catch (error) {
    await Promise.all(uploadedObjectKeys.map((objectKey) => deletePlantPhotoObject(objectKey).catch(() => undefined)));
    throw error;
  }

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
    imageDataUrls: preparedImages.map((image) => image.imageDataUrl),
    plantContext,
    title: preparedImages.length > 1 ? `${batchTitle} (${preparedImages.length} vues)` : batchTitle,
    colorAnomalyReport
  }).catch((error) => ({
    summary: error instanceof Error ? error.message : "Analyse photo indisponible.",
    observations: colorAnomalyReport.findings.length ? [colorAnomalyReport.summary] : [],
    recommendations: ["Relancer l'analyse lorsque OpenRouter est disponible."],
    visualTags: colorAnomalyReport.tags,
    colorAnomalyScore: colorAnomalyReport.anomalyScore,
    healthScore: null,
    confidence: 0
  }));

  const photos = await prisma.$transaction(
    preparedImages.map((image) => prisma.plantPhoto.create({
      data: {
        plantId: plant.id,
        title: image.title,
        objectKey: image.objectKey,
        mimeType: image.mimeType,
        sizeBytes: image.bytes.length,
        takenAt: image.takenAt ? new Date(image.takenAt) : null,
        analysis: analysis.summary,
        observations: JSON.stringify(analysis.observations),
        recommendations: JSON.stringify(analysis.recommendations),
        healthScore: analysis.healthScore,
        confidence: analysis.confidence,
        colorTags: JSON.stringify(image.colorReport.tags),
        colorAnomalyScore: image.colorReport.anomalyScore,
        colorAnomalyConfidence: image.colorReport.confidence,
        colorFindings: JSON.stringify(image.colorReport.findings)
      }
    }))
  ).catch(async (error) => {
    await Promise.all(uploadedObjectKeys.map((objectKey) => deletePlantPhotoObject(objectKey).catch(() => undefined)));
    throw error;
  });

  if (analysis.summary) {
    const photoLabel = photos.length === 1
      ? `Photo "${photos[0].title}"`
      : `Analyse ${photos.length} vues "${batchTitle}"`;
    await prisma.memory.create({
      data: {
        plantId: plant.id,
        kind: "sensor_observation",
        content: `${photoLabel}: ${analysis.summary.slice(0, 700)}${analysis.visualTags.length ? ` Tags couleur: ${analysis.visualTags.join(", ")}.` : ""}`
      }
    });
  }

  for (const photo of photos) {
    void collectTrainingSampleFromPhoto(plant.id, photo).catch(() => undefined);
  }

  const serializedPhotos = photos.map(serializePhoto);
  return NextResponse.json({ photo: serializedPhotos[0], photos: serializedPhotos });
}

export async function DELETE(request: NextRequest) {
  const body = plantPhotoDeleteSchema.parse(await request.json());
  const photo = await prisma.plantPhoto.findUniqueOrThrow({ where: { id: body.id } });

  await deletePlantPhotoObject(photo.objectKey).catch(() => undefined);
  await prisma.plantPhoto.delete({ where: { id: body.id } });

  return NextResponse.json({ ok: true });
}
