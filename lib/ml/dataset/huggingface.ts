import { FEATURE_KEYS } from "../featureVector"
import { toJsonl } from "./export"
import { buildDatasheet, type DatasetMeta } from "./datasheet"
import type { DatasetRow, DatasetStats } from "./types"

/**
 * Construit un bundle d'export façon Hugging Face: prêt à être uploadé sur le Hub.
 *  - `data.jsonl`     : les échantillons (forme canonique).
 *  - `README.md`      : carte de dataset (datasheet + front-matter YAML).
 *  - `metadata.json`  : schéma machine-lisible (features, version, splits, licence).
 *
 * Aucun upload automatique (pas de credentials HF côté serveur) — l'appelant
 * pousse ces artefacts où il veut.
 */
export function buildHfExport(
  meta: DatasetMeta,
  rows: DatasetRow[],
  stats: DatasetStats
): { "data.jsonl": string; "README.md": string; "metadata.json": string } {
  const yamlFrontMatter = [
    "---",
    `pretty_name: ${JSON.stringify(meta.name)}`,
    `license: ${meta.license.toLowerCase()}`,
    "task_categories:",
    "  - tabular-regression",
    "tags:",
    "  - plants",
    "  - iot",
    "  - agriculture",
    "size_categories:",
    `  - ${stats.sampleCount < 1000 ? "n<1K" : "1K<n<10K"}`,
    "---",
    ""
  ].join("\n")

  const readme = yamlFrontMatter + buildDatasheet(meta, stats)

  const metadata = {
    name: meta.name,
    slug: meta.slug,
    description: meta.description,
    license: meta.license,
    featureSchemaVersion: meta.featureSchemaVersion,
    sampleCount: stats.sampleCount,
    target: { name: "label", type: "float", range: [0, 100], description: "Score de santé 0–100" },
    features: FEATURE_KEYS.map(name => ({ name, type: "float" })),
    fields: ["features", "label", "labelSource", "plantId", "sampledAt"],
    splits: { train: stats.sampleCount },
    labelDistribution: {
      min: stats.labelMin,
      max: stats.labelMax,
      mean: stats.labelMean,
      std: stats.labelStd,
      histogram: stats.histogram,
      perLabelSource: stats.perLabelSource
    },
    citation: `@misc{${meta.slug}, title={${meta.name}}, author={Arborisis Garden}}`
  }

  return {
    "data.jsonl": toJsonl(rows),
    "README.md": readme,
    "metadata.json": JSON.stringify(metadata, null, 2)
  }
}
