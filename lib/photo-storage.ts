import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

type DataUrlParts = {
  mimeType: string;
  bytes: Buffer;
};

function readRequiredEnv(names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  throw new Error(`Variable bucket manquante: ${names.join(" ou ")}`);
}

function readOptionalEnv(names: string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
}

function getBucketConfig() {
  const endpoint = readRequiredEnv(["PHOTO_BUCKET_ENDPOINT", "RAILWAY_BUCKET_ENDPOINT", "BUCKET_ENDPOINT"]);
  const bucketName = readRequiredEnv(["PHOTO_BUCKET_NAME", "RAILWAY_BUCKET_NAME", "BUCKET_NAME"]);
  const accessKeyId = readRequiredEnv(["PHOTO_BUCKET_ACCESS_KEY_ID", "RAILWAY_BUCKET_ACCESS_KEY_ID", "BUCKET_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"]);
  const secretAccessKey = readRequiredEnv(["PHOTO_BUCKET_SECRET_ACCESS_KEY", "RAILWAY_BUCKET_SECRET_ACCESS_KEY", "BUCKET_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY"]);
  const region = readOptionalEnv(["PHOTO_BUCKET_REGION", "RAILWAY_BUCKET_REGION", "BUCKET_REGION", "AWS_REGION"]) ?? "auto";
  const urlStyle = readOptionalEnv(["PHOTO_BUCKET_URL_STYLE", "RAILWAY_BUCKET_URL_STYLE", "BUCKET_URL_STYLE"]);

  return {
    endpoint,
    bucketName,
    region,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: urlStyle !== "virtual-host" && urlStyle !== "virtual-hosted"
  };
}

function getS3Client() {
  const config = getBucketConfig();
  return {
    bucketName: config.bucketName,
    client: new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    })
  };
}

export function parseImageDataUrl(imageDataUrl: string): DataUrlParts {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(imageDataUrl);
  if (!match) {
    throw new Error("Format image invalide. Utilise PNG, JPG ou WebP.");
  }

  const mimeType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > 5 * 1024 * 1024) {
    throw new Error("Photo trop lourde. Limite: 5 Mo apres compression.");
  }

  return { mimeType, bytes };
}

export function createPhotoObjectKey(plantId: string, mimeType: string) {
  const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const date = new Date().toISOString().slice(0, 10);
  return `plants/${plantId}/photos/${date}/${randomUUID()}.${extension}`;
}

export async function uploadPlantPhotoObject(input: {
  objectKey: string;
  mimeType: string;
  bytes: Buffer;
}) {
  const { client, bucketName } = getS3Client();
  await client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: input.objectKey,
    Body: input.bytes,
    ContentType: input.mimeType,
    CacheControl: "public, max-age=31536000, immutable"
  }));
}

export async function getPlantPhotoObject(objectKey: string) {
  const { client, bucketName } = getS3Client();
  const object = await client.send(new GetObjectCommand({
    Bucket: bucketName,
    Key: objectKey
  }));

  if (!object.Body) {
    throw new Error("Objet photo introuvable");
  }

  const bytes = await object.Body.transformToByteArray();
  return {
    bytes,
    mimeType: object.ContentType ?? "image/jpeg",
    cacheControl: object.CacheControl ?? "public, max-age=3600"
  };
}

export async function deletePlantPhotoObject(objectKey: string) {
  const { client, bucketName } = getS3Client();
  await client.send(new DeleteObjectCommand({
    Bucket: bucketName,
    Key: objectKey
  }));
}
