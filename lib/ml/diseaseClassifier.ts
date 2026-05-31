import { createHash } from "node:crypto"
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { InferenceSession } from "onnxruntime-node"
import sharp from "sharp"
import { formatDiseaseLabel, getDiseaseLabels, type DiseaseLabel } from "./diseaseLabels"

export type DiseasePrediction = {
  label: string
  raw: string
  plant: string
  condition: string
  healthy: boolean
  probability: number
}

export type DiseaseReport = {
  /** false quand aucun modele n'est configure ou que le chargement a echoue. */
  available: boolean
  modelVersion: string
  topLabel: string | null
  /** Sante de la classe gagnante; null si modele indisponible. */
  healthy: boolean | null
  /** Probabilite de la classe gagnante (0..1). */
  confidence: number
  /** Probabilite cumulee des classes non saines (score "plante malade", 0..1). */
  diseaseConfidence: number
  predictions: DiseasePrediction[]
  summary: string
}

type Normalization = "imagenet" | "0_1" | "minus1_1"

const IMAGENET_MEAN = [0.485, 0.456, 0.406]
const IMAGENET_STD = [0.229, 0.224, 0.225]

function round(v: number, decimals = 3): number {
  const scale = 10 ** decimals
  return Math.round(v * scale) / scale
}

export function emptyDiseaseReport(): DiseaseReport {
  return {
    available: false,
    modelVersion: "none",
    topLabel: null,
    healthy: null,
    confidence: 0,
    diseaseConfidence: 0,
    predictions: [],
    summary: "Classification de maladies par modele ONNX desactivee (aucun modele configure)."
  }
}

function failedDiseaseReport(reason: string): DiseaseReport {
  return { ...emptyDiseaseReport(), summary: `Classification ONNX indisponible: ${reason}` }
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function modelConfig() {
  const url = process.env.PLANT_DISEASE_MODEL_URL?.trim() || ""
  const path = process.env.PLANT_DISEASE_MODEL_PATH?.trim() || ""
  // Cle d'objet dans le bucket S3 de l'app (Railway Object Storage prive): charge
  // le modele via le client S3 authentifie plutot qu'un fetch HTTP.
  const bucketKey = process.env.PLANT_DISEASE_MODEL_BUCKET_KEY?.trim() || ""
  const dir = process.env.PLANT_DISEASE_MODEL_DIR?.trim() || join(tmpdir(), "arborisis-models")
  const inputSize = envInt("PLANT_DISEASE_INPUT_SIZE", 224)
  const topK = Math.min(getDiseaseLabels().length, envInt("PLANT_DISEASE_TOPK", 3))
  const layout = (process.env.PLANT_DISEASE_LAYOUT?.trim().toLowerCase() === "nhwc" ? "nhwc" : "nchw") as "nchw" | "nhwc"
  const normalize = ((): Normalization => {
    const raw = process.env.PLANT_DISEASE_NORMALIZE?.trim().toLowerCase()
    if (raw === "0_1") return "0_1"
    if (raw === "minus1_1") return "minus1_1"
    return "imagenet"
  })()
  const applySoftmax = process.env.PLANT_DISEASE_APPLY_SOFTMAX?.trim() !== "0"
  return { url, path, bucketKey, dir, inputSize, topK, layout, normalize, applySoftmax }
}

let sessionPromise: Promise<InferenceSession | null> | null = null
let warnedOnce = false

function warnOnce(message: string) {
  if (warnedOnce) return
  warnedOnce = true
  console.warn(`[disease-classifier] ${message}`)
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

// Telecharge le modele depuis l'URL et le met en cache sur disque. Le nom de
// fichier derive d'un hash de l'URL pour invalider le cache quand l'URL change.
// Telechargement atomique (fichier .part puis rename) pour resister aux demarrages concurrents.
async function ensureModelFile(config: ReturnType<typeof modelConfig>): Promise<string | null> {
  if (config.path) {
    return (await fileExists(config.path)) ? config.path : null
  }

  // Source du modele: cle bucket S3 (prioritaire) ou URL HTTP. Cache local par hash.
  const source = config.bucketKey
    ? { kind: "bucket" as const, id: config.bucketKey }
    : config.url
      ? { kind: "url" as const, id: config.url }
      : null
  if (!source) return null

  const hash = createHash("sha1").update(`${source.kind}:${source.id}`).digest("hex").slice(0, 16)
  const target = join(config.dir, `plant-disease-${hash}.onnx`)
  if (await fileExists(target)) return target

  let bytes: Buffer
  if (source.kind === "bucket") {
    const { downloadBucketObject } = await import("@/lib/photo-storage")
    bytes = await downloadBucketObject(source.id)
  } else {
    const response = await fetch(source.id)
    if (!response.ok || !response.body) {
      throw new Error(`telechargement modele HTTP ${response.status}`)
    }
    bytes = Buffer.from(await response.arrayBuffer())
  }
  if (bytes.length < 1024) throw new Error("fichier modele trop petit / invalide")

  await mkdir(config.dir, { recursive: true })
  const partial = `${target}.${process.pid}.part`
  await writeFile(partial, bytes)
  await rename(partial, target)
  return target
}

async function loadSession(): Promise<InferenceSession | null> {
  const config = modelConfig()
  if (!config.url && !config.path && !config.bucketKey) return null

  const modelPath = await ensureModelFile(config)
  if (!modelPath) {
    warnOnce("aucun fichier modele resolu (verifie PLANT_DISEASE_MODEL_URL / _PATH)")
    return null
  }

  // Import dynamique: binaire natif charge uniquement cote serveur, a la demande.
  const ort = await import("onnxruntime-node")
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all"
  })
  return session
}

function getSession(): Promise<InferenceSession | null> {
  if (!sessionPromise) {
    sessionPromise = loadSession().catch((error) => {
      warnOnce(error instanceof Error ? error.message : String(error))
      // On reinitialise pour permettre une nouvelle tentative au prochain upload.
      sessionPromise = null
      return null
    })
  }
  return sessionPromise
}

// Pretraitement: redimensionne en carre, retire l'alpha, normalise et empile en
// tenseur [1,3,H,W] (NCHW) ou [1,H,W,3] (NHWC).
async function preprocess(
  bytes: Buffer,
  config: ReturnType<typeof modelConfig>
): Promise<Float32Array> {
  const size = config.inputSize
  // fit "cover" = redimensionne en preservant le ratio puis recadre au centre,
  // proche du resize-puis-center-crop attendu par la plupart des classifieurs.
  const { data } = await sharp(bytes, { failOn: "none" })
    .rotate()
    .resize(size, size, { fit: "cover", position: "centre" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const plane = size * size
  const tensor = new Float32Array(plane * 3)
  const mean = config.normalize === "imagenet" ? IMAGENET_MEAN : [0, 0, 0]
  const std = config.normalize === "imagenet" ? IMAGENET_STD : [1, 1, 1]

  for (let i = 0; i < plane; i++) {
    const offset = i * 3
    for (let c = 0; c < 3; c++) {
      let value = data[offset + c] / 255
      if (config.normalize === "minus1_1") value = value * 2 - 1
      value = (value - mean[c]) / std[c]
      if (config.layout === "nhwc") tensor[i * 3 + c] = value
      else tensor[c * plane + i] = value
    }
  }

  return tensor
}

function softmax(values: Float32Array | number[]): number[] {
  let max = -Infinity
  for (const v of values) if (v > max) max = v
  let sum = 0
  const exps = new Array<number>(values.length)
  for (let i = 0; i < values.length; i++) {
    const e = Math.exp(values[i] - max)
    exps[i] = e
    sum += e
  }
  return sum > 0 ? exps.map((e) => e / sum) : exps.map(() => 1 / values.length)
}

function buildReport(probabilities: number[], labels: DiseaseLabel[], topK: number, modelVersion: string): DiseaseReport {
  const count = Math.min(probabilities.length, labels.length)
  const indexed = Array.from({ length: count }, (_, i) => ({ i, p: probabilities[i] }))
  indexed.sort((a, b) => b.p - a.p)

  const predictions: DiseasePrediction[] = indexed.slice(0, topK).map(({ i, p }) => ({
    label: formatDiseaseLabel(labels[i]),
    raw: labels[i].raw,
    plant: labels[i].plant,
    condition: labels[i].condition,
    healthy: labels[i].healthy,
    probability: round(p, 4)
  }))

  let diseaseConfidence = 0
  for (let i = 0; i < count; i++) {
    if (!labels[i].healthy) diseaseConfidence += probabilities[i]
  }

  const top = predictions[0] ?? null
  const summary = top
    ? top.healthy
      ? `Modele ONNX: feuillage le plus proche de "${top.label}" (${Math.round(top.probability * 100)}%), aucune pathologie dominante.`
      : `Modele ONNX: signe le plus probable "${top.label}" (${Math.round(top.probability * 100)}%); probabilite globale de maladie ${Math.round(diseaseConfidence * 100)}%.`
    : "Modele ONNX: sortie vide."

  return {
    available: true,
    modelVersion,
    topLabel: top ? top.label : null,
    healthy: top ? top.healthy : null,
    confidence: round(top?.probability ?? 0, 4),
    diseaseConfidence: round(Math.min(1, diseaseConfidence), 4),
    predictions,
    summary
  }
}

/**
 * Classe une image de plante via le modele ONNX de detection de maladies.
 * Renvoie un rapport `available:false` (jamais une exception) si le modele est
 * desactive ou indisponible, pour ne jamais bloquer le pipeline d'upload.
 */
export async function classifyPlantDisease(input: { bytes: Buffer }): Promise<DiseaseReport> {
  const config = modelConfig()
  if (!config.url && !config.path && !config.bucketKey) return emptyDiseaseReport()

  try {
    const session = await getSession()
    if (!session) return failedDiseaseReport("modele non charge")

    const labels = getDiseaseLabels()
    const ort = await import("onnxruntime-node")
    const tensorData = await preprocess(input.bytes, config)
    const dims = config.layout === "nhwc"
      ? [1, config.inputSize, config.inputSize, 3]
      : [1, 3, config.inputSize, config.inputSize]
    const tensor = new ort.Tensor("float32", tensorData, dims)

    const inputName = session.inputNames[0]
    const outputs = await session.run({ [inputName]: tensor })
    const outputName = session.outputNames[0]
    const raw = outputs[outputName]?.data as Float32Array | undefined
    if (!raw || !raw.length) return failedDiseaseReport("sortie modele vide")

    if (raw.length !== labels.length) {
      warnOnce(`taille de sortie (${raw.length}) != nombre de labels (${labels.length}); mapping par index`)
    }

    const probabilities = config.applySoftmax ? softmax(raw) : Array.from(raw)
    const version = config.path ? "local" : config.bucketKey ? "bucket" : "remote"
    return buildReport(probabilities, labels, config.topK, version)
  } catch (error) {
    warnOnce(error instanceof Error ? error.message : String(error))
    return failedDiseaseReport(error instanceof Error ? error.message : "erreur inference")
  }
}

/** Fusionne les rapports de plusieurs vues: retient le signal de maladie le plus fort. */
export function mergeDiseaseReports(reports: DiseaseReport[]): DiseaseReport {
  const available = reports.filter((report) => report.available)
  if (!available.length) return reports[0] ?? emptyDiseaseReport()

  // Vue la plus alarmante: plus forte probabilite cumulee de maladie, puis confiance.
  return available
    .slice()
    .sort((a, b) => b.diseaseConfidence - a.diseaseConfidence || b.confidence - a.confidence)[0]
}

/** Lecture seule de l'etat de configuration (sans charger le modele). */
export function diseaseModelConfigured(): boolean {
  return Boolean(
    process.env.PLANT_DISEASE_MODEL_URL?.trim() ||
    process.env.PLANT_DISEASE_MODEL_PATH?.trim() ||
    process.env.PLANT_DISEASE_MODEL_BUCKET_KEY?.trim()
  )
}
