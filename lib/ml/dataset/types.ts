import type { MLFeatures } from "../types"
import type { LabelSource } from "../labels"

/**
 * Une ligne de dataset, telle que sérialisée à l'export. C'est la forme
 * canonique d'un échantillon figé: features + label + provenance.
 */
export type DatasetRow = {
  features: MLFeatures
  label: number
  labelSource: LabelSource | string
  plantId: string
  sampledAt: string // ISO
}

export type DatasetStats = {
  sampleCount: number
  labelMin: number
  labelMax: number
  labelMean: number
  labelStd: number
  histogram: number[] // 10 bacs sur [0,100]
  perLabelSource: Record<string, number>
  plantIds: string[]
  dateRangeStart: string | null
  dateRangeEnd: string | null
}
