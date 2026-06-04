import { prisma } from "@/lib/prisma"
import { trainWeights } from "../trainer"
import { FEATURE_SCHEMA_VERSION } from "../featureVector"
import { DEFAULT_WEIGHTS, type ModelWeights } from "../types"
import { loadDatasetRows, rowsToTrainingSamples } from "./builder"

async function getCurrentWeights(): Promise<ModelWeights> {
  const active = await prisma.mLModelVersion.findFirst({
    where: { isActive: true },
    orderBy: { trainedAt: "desc" }
  })
  if (!active) return DEFAULT_WEIGHTS
  try { return JSON.parse(active.weights) as ModelWeights } catch { return DEFAULT_WEIGHTS }
}

export type TrainFromDatasetResult = {
  ok: true
  version: string
  sampleCount: number
  adopted: boolean
  rmse: number
  mae: number
  valRmse: number
  residualKind: string
  epochs: number
} | {
  ok: false
  error: string
  status: number
}

/**
 * Entraîne un nouveau modèle À PARTIR D'UN DATASET FIGÉ et l'enregistre comme
 * MLModelVersion actif (avec provenance). Réutilise `trainWeights` et sa porte
 * d'adoption k-fold — la nouvelle version ne devient active que si elle bat le
 * prior out-of-fold. Partagé entre la route train et l'auto-train d'agent/tick.
 */
export async function trainFromDataset(datasetId: string, epochs = 300): Promise<TrainFromDatasetResult> {
  const dataset = await prisma.mLDataset.findUnique({ where: { id: datasetId } })
  if (!dataset) return { ok: false, error: "Dataset introuvable", status: 404 }
  if (dataset.status === "draft") {
    return { ok: false, error: "Dataset non figé — figez-le d'abord", status: 422 }
  }
  if (dataset.featureSchemaVersion !== FEATURE_SCHEMA_VERSION) {
    return {
      ok: false,
      status: 422,
      error: `Version de schéma incompatible (dataset v${dataset.featureSchemaVersion}, code v${FEATURE_SCHEMA_VERSION})`
    }
  }

  const rows = await loadDatasetRows(datasetId)
  if (rows.length < 3) {
    return { ok: false, error: `Dataset trop petit (${rows.length} < 3)`, status: 422 }
  }

  const samples = rowsToTrainingSamples(rows)
  const initial = await getCurrentWeights()
  const result = trainWeights(initial, samples, epochs)

  const version = `v${Date.now()}`
  await prisma.$transaction([
    prisma.mLModelVersion.updateMany({ where: {}, data: { isActive: false } }),
    prisma.mLModelVersion.create({
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
        isActive: true,
        datasetId: dataset.id,
        datasetVersion: dataset.slug,
        featureSchemaVersion: FEATURE_SCHEMA_VERSION,
        trainedFrom: "dataset"
      }
    }),
    prisma.mLTrainingSample.updateMany({ where: {}, data: { prediction: null } })
  ])

  return {
    ok: true,
    version,
    sampleCount: result.sampleCount,
    adopted: result.adopted,
    rmse: result.rmse,
    mae: result.mae,
    valRmse: result.valRmse,
    residualKind: result.residualKind,
    epochs: result.epochs
  }
}
