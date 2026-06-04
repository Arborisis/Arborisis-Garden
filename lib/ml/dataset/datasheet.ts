import { FEATURE_KEYS } from "../featureVector"
import type { DatasetStats } from "./types"

export type DatasetMeta = {
  name: string
  slug: string
  description: string
  license: string
  featureSchemaVersion: number
}

function histogramTable(histogram: number[]): string {
  const lines = ["| Plage santé | Échantillons |", "| --- | --- |"]
  for (let i = 0; i < histogram.length; i++) {
    const lo = Math.round((i / histogram.length) * 100)
    const hi = Math.round(((i + 1) / histogram.length) * 100)
    lines.push(`| ${lo}–${hi} | ${histogram[i]} |`)
  }
  return lines.join("\n")
}

/**
 * Génère la datasheet markdown (FR) décrivant le dataset: volume, distribution
 * des labels, plage temporelle, plantes couvertes, liste des features, usage
 * prévu et limites. Sert de README et de fiche de transparence à la publication.
 */
export function buildDatasheet(meta: DatasetMeta, stats: DatasetStats): string {
  const sourceRows = Object.entries(stats.perLabelSource)
    .map(([k, v]) => `- \`${k}\` : ${v}`)
    .join("\n") || "- (aucune)"

  const featureRows = FEATURE_KEYS.map(k => `- \`${k}\``).join("\n")

  return `# ${meta.name}

${meta.description || "_Dataset de santé de plantes — Arborisis Garden._"}

- **Slug** : \`${meta.slug}\`
- **Licence** : ${meta.license}
- **Version du schéma de features** : ${meta.featureSchemaVersion}
- **Échantillons** : ${stats.sampleCount}
- **Plantes couvertes** : ${stats.plantIds.length}
- **Période** : ${stats.dateRangeStart ?? "—"} → ${stats.dateRangeEnd ?? "—"}

## Label (santé 0–100)

- min : ${stats.labelMin.toFixed(1)} · max : ${stats.labelMax.toFixed(1)}
- moyenne : ${stats.labelMean.toFixed(1)} · écart-type : ${stats.labelStd.toFixed(1)}

### Distribution

${histogramTable(stats.histogram)}

### Sources de label

${sourceRows}

## Features (${FEATURE_KEYS.length})

Chaque échantillon contient un objet \`features\` normalisé (0–1 sauf valeurs
brutes d'humidité/cible/pente, exclues du vecteur d'apprentissage) :

${featureRows}

## Usage prévu

Entraîner/affiner le modèle de santé d'Arborisis Garden (mélange d'experts
engineered + tête résiduelle bornée). Le label est un score de santé 0–100.

## Limites

- **Faible volume** : jeu domestique (< 20 plantes). Statistiques fragiles ;
  le modèle conserve une porte d'adoption k-fold pour ne jamais régresser.
- **Bruit de label** : les labels \`photo\` proviennent d'une analyse visuelle LLM
  (subjective) ; les labels \`sensor_derived\` sont heuristiques et de confiance basse.
- **Circularité \`sensor_derived\`** : ces labels dérivent de l'expert capteur du
  modèle lui-même ; ils sont volontairement minoritaires et de faible confiance.
- **Cohérence de schéma** : ne mélangez pas des échantillons de versions de schéma
  de features différentes.
`
}
