import type { DatasetRow, DatasetStats } from "./types"

const HIST_BINS = 10

/**
 * Calcule les statistiques d'un dataset: count, min/max/mean/std du label,
 * histogramme 10 bacs sur [0,100], répartition par source de label, plantes
 * couvertes, plage de dates. Pur et déterministe.
 *
 * Garanties (vérifiées par le smoke test):
 *  - la somme des bacs de l'histogramme == sampleCount
 *  - labelMean ∈ [labelMin, labelMax]
 */
export function computeDatasetStats(rows: DatasetRow[]): DatasetStats {
  const n = rows.length
  if (n === 0) {
    return {
      sampleCount: 0,
      labelMin: 0,
      labelMax: 0,
      labelMean: 0,
      labelStd: 0,
      histogram: new Array(HIST_BINS).fill(0),
      perLabelSource: {},
      plantIds: [],
      dateRangeStart: null,
      dateRangeEnd: null
    }
  }

  let min = Infinity
  let max = -Infinity
  let sum = 0
  const histogram = new Array(HIST_BINS).fill(0)
  const perLabelSource: Record<string, number> = {}
  const plantIdSet = new Set<string>()
  let minTime = Infinity
  let maxTime = -Infinity

  for (const r of rows) {
    const label = r.label
    if (label < min) min = label
    if (label > max) max = label
    sum += label

    // Bac d'histogramme: [0,100] réparti en 10 bacs, 100 tombe dans le dernier bac.
    const idx = Math.min(HIST_BINS - 1, Math.max(0, Math.floor((label / 100) * HIST_BINS)))
    histogram[idx]++

    perLabelSource[r.labelSource] = (perLabelSource[r.labelSource] ?? 0) + 1
    plantIdSet.add(r.plantId)

    const t = new Date(r.sampledAt).getTime()
    if (Number.isFinite(t)) {
      if (t < minTime) minTime = t
      if (t > maxTime) maxTime = t
    }
  }

  const mean = sum / n
  let varSum = 0
  for (const r of rows) varSum += (r.label - mean) ** 2
  const std = Math.sqrt(varSum / n)

  return {
    sampleCount: n,
    labelMin: min,
    labelMax: max,
    labelMean: mean,
    labelStd: std,
    histogram,
    perLabelSource,
    plantIds: [...plantIdSet].sort(),
    dateRangeStart: Number.isFinite(minTime) ? new Date(minTime).toISOString() : null,
    dateRangeEnd: Number.isFinite(maxTime) ? new Date(maxTime).toISOString() : null
  }
}
