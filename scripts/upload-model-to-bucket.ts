/**
 * Upload du modele ONNX de detection de maladies dans le bucket S3 de l'app.
 *
 * Utilise les credentials bucket de l'environnement (PHOTO_BUCKET_*). En local
 * ils sont absents: lancer via Railway pour les injecter:
 *
 *   railway run --service web -- node --import tsx scripts/upload-model-to-bucket.ts
 *
 * Variables optionnelles:
 *   MODEL_FILE  (defaut: models/plant-disease-mobilenetv2.onnx)
 *   MODEL_KEY   (defaut: models/plant-disease-mobilenetv2.onnx)
 */
import { readFile, stat } from "node:fs/promises"
import { uploadBucketObject } from "../lib/photo-storage"

const file = process.env.MODEL_FILE || "models/plant-disease-mobilenetv2.onnx"
const key = process.env.MODEL_KEY || "models/plant-disease-mobilenetv2.onnx"

async function main() {
  const info = await stat(file).catch(() => null)
  if (!info) {
    console.error(`Fichier introuvable: ${file}\nGenere-le d'abord: python3 scripts/convert-plant-disease-model.py`)
    process.exit(1)
  }
  const bytes = await readFile(file)
  console.log(`Upload ${file} (${(bytes.length / 1e6).toFixed(2)} Mo) -> bucket key "${key}" ...`)
  await uploadBucketObject({ objectKey: key, bytes, contentType: "application/octet-stream" })
  console.log(`OK. Definis PLANT_DISEASE_MODEL_BUCKET_KEY="${key}" sur le service.`)
}

main().catch((error) => {
  console.error("Echec upload:", error instanceof Error ? error.message : error)
  process.exit(1)
})
