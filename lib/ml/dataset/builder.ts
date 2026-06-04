import { prisma } from "@/lib/prisma"
import { FEATURE_SCHEMA_VERSION } from "../featureVector"
import { computeDatasetStats } from "./stats"
import type { DatasetRow } from "./types"
import type { TrainingSample } from "../types"

export type DatasetFilter = {
  plantId?: string
  from?: string // ISO
  to?: string // ISO
  labelSource?: string
}

type RawSample = {
  features: string
  label: number
  labelSource: string
  plantId: string
  sampledAt: Date
  featureSchemaVersion: number
}

function parseRows(raw: RawSample[]): DatasetRow[] {
  return raw.flatMap(s => {
    try {
      return [{
        features: JSON.parse(s.features),
        label: s.label,
        labelSource: s.labelSource,
        plantId: s.plantId,
        sampledAt: s.sampledAt.toISOString()
      } satisfies DatasetRow]
    } catch {
      return []
    }
  })
}

/**
 * Sélectionne les échantillons d'entraînement correspondant au filtre, restreints
 * à la version de schéma de features courante (on ne mélange jamais les versions).
 * Renvoie les lignes parsées + leur id source pour le lignage.
 */
export async function selectTrainingRows(filter: DatasetFilter): Promise<{ rows: DatasetRow[]; sourceIds: string[] }> {
  const sampledAt: { gte?: Date; lte?: Date } = {}
  if (filter.from) sampledAt.gte = new Date(filter.from)
  if (filter.to) sampledAt.lte = new Date(filter.to)

  const raw = await prisma.mLTrainingSample.findMany({
    where: {
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      ...(filter.plantId ? { plantId: filter.plantId } : {}),
      ...(filter.labelSource ? { labelSource: filter.labelSource } : {}),
      ...(Object.keys(sampledAt).length ? { sampledAt } : {})
    },
    orderBy: { sampledAt: "asc" }
  })

  return {
    rows: parseRows(raw),
    sourceIds: raw.map(s => s.id)
  }
}

/**
 * (Re)construit le contenu d'un dataset draft: remplace ses membres par la
 * sélection courante (copie immuable des features/label) et recalcule les stats.
 * Refuse de toucher un dataset figé/publié. Renvoie le dataset à jour.
 */
export async function buildDraft(datasetId: string, filter: DatasetFilter) {
  const dataset = await prisma.mLDataset.findUnique({ where: { id: datasetId } })
  if (!dataset) throw new Error("dataset introuvable")
  if (dataset.status !== "draft") throw new Error("dataset déjà figé/publié — immuable")

  const { rows, sourceIds } = await selectTrainingRows(filter)
  const stats = computeDatasetStats(rows)

  await prisma.$transaction([
    prisma.mLDatasetSample.deleteMany({ where: { datasetId } }),
    prisma.mLDatasetSample.createMany({
      data: rows.map((r, i) => ({
        datasetId,
        sourceSampleId: sourceIds[i] ?? null,
        plantId: r.plantId,
        sampledAt: new Date(r.sampledAt),
        features: JSON.stringify(r.features),
        label: r.label,
        labelSource: r.labelSource,
        featureSchemaVersion: FEATURE_SCHEMA_VERSION
      }))
    }),
    prisma.mLDataset.update({
      where: { id: datasetId },
      data: {
        sampleCount: stats.sampleCount,
        featureSchemaVersion: FEATURE_SCHEMA_VERSION,
        labelDistribution: JSON.stringify(stats),
        dateRangeStart: stats.dateRangeStart ? new Date(stats.dateRangeStart) : null,
        dateRangeEnd: stats.dateRangeEnd ? new Date(stats.dateRangeEnd) : null,
        plantIds: JSON.stringify(stats.plantIds),
        filterSpec: JSON.stringify(filter)
      }
    })
  ])

  return prisma.mLDataset.findUnique({ where: { id: datasetId } })
}

/** Charge les membres d'un dataset (figé ou non) sous forme de DatasetRow[]. */
export async function loadDatasetRows(datasetId: string): Promise<DatasetRow[]> {
  const members = await prisma.mLDatasetSample.findMany({
    where: { datasetId },
    orderBy: { sampledAt: "asc" }
  })
  return parseRows(members.map(m => ({
    features: m.features,
    label: m.label,
    labelSource: m.labelSource,
    plantId: m.plantId,
    sampledAt: m.sampledAt,
    featureSchemaVersion: m.featureSchemaVersion
  })))
}

/** Convertit des DatasetRow[] en TrainingSample[] pour `trainWeights`. */
export function rowsToTrainingSamples(rows: DatasetRow[]): TrainingSample[] {
  return rows.map(r => ({
    features: r.features,
    label: r.label,
    plantId: r.plantId,
    sampledAt: r.sampledAt,
    photoId: ""
  }))
}
