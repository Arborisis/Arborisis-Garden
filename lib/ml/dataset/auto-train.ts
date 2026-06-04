import { prisma } from "@/lib/prisma"
import { FEATURE_SCHEMA_VERSION } from "../featureVector"
import { buildDraft, loadDatasetRows } from "./builder"
import { freezeSnapshot } from "./snapshot"
import { trainFromDataset } from "./train"

export type AutoTrainOutcome = {
  triggered: boolean
  newSamples?: number
  threshold?: number
  datasetSlug?: string
  version?: string
  adopted?: boolean
  reason?: string
}

/**
 * Auto-entraînement piloté par ML_AUTO_TRAIN_THRESHOLD (défaut 10): quand assez
 * de nouveaux échantillons se sont accumulés depuis le dernier modèle entraîné,
 * construit un dataset auto, le fige (snapshot S3), et entraîne. La porte
 * d'adoption k-fold de `trainWeights` garantit qu'un modèle moins bon ne devient
 * jamais actif. Appelé depuis /api/agent/tick (sweep par scheduler externe).
 *
 * `now` est injecté (pas de Date.now ici) pour rester nommable/testable.
 */
export async function maybeAutoTrain(now: Date): Promise<AutoTrainOutcome> {
  const threshold = Number(process.env.ML_AUTO_TRAIN_THRESHOLD ?? 10)
  if (!Number.isFinite(threshold) || threshold <= 0) {
    return { triggered: false, reason: "seuil désactivé" }
  }

  const active = await prisma.mLModelVersion.findFirst({
    where: { isActive: true },
    orderBy: { trainedAt: "desc" }
  })

  // Compter les échantillons (schéma courant) créés depuis le dernier entraînement.
  const newSamples = await prisma.mLTrainingSample.count({
    where: {
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      ...(active ? { createdAt: { gt: active.trainedAt } } : {})
    }
  })

  if (newSamples < threshold) {
    return { triggered: false, newSamples, threshold }
  }

  // Construire un dataset auto daté, le figer, puis entraîner. Pas d'auto-HTTP.
  const slug = `auto-${now.toISOString().slice(0, 10)}-${now.getTime()}`
  const dataset = await prisma.mLDataset.create({
    data: { name: `Auto ${now.toISOString().slice(0, 10)}`, slug, description: "Dataset auto-généré (auto-train)." }
  })

  await buildDraft(dataset.id, {})
  const refreshed = await prisma.mLDataset.findUnique({ where: { id: dataset.id } })
  if (!refreshed || refreshed.sampleCount < 3) {
    return { triggered: false, newSamples, threshold, reason: "trop peu d'échantillons après build" }
  }

  const rows = await loadDatasetRows(dataset.id)
  const snapshot = await freezeSnapshot(slug, rows)
  await prisma.mLDataset.update({
    where: { id: dataset.id },
    data: { status: "frozen", snapshotObjectKey: snapshot.objectKey, checksum: snapshot.checksum, frozenAt: now }
  })

  const result = await trainFromDataset(dataset.id)
  if (!result.ok) {
    return { triggered: true, newSamples, threshold, datasetSlug: slug, reason: result.error }
  }

  return {
    triggered: true,
    newSamples,
    threshold,
    datasetSlug: slug,
    version: result.version,
    adopted: result.adopted
  }
}
