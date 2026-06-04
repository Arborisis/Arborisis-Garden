import type { MLFeatures } from "./types"
import { computeSensorScore } from "./scoring"

/**
 * Sources de labels d'entraînement, par ordre de fiabilité décroissante.
 *  - "photo"          : score de santé issu de l'analyse visuelle LLM (label primaire).
 *  - "manual"         : correction humaine explicite (la plus fiable — l'utilisateur a raison).
 *  - "agent"          : score de santé produit par la boucle agentique LLM.
 *  - "sensor_derived" : heuristique capteurs seule, quand aucune photo notée n'existe.
 */
export type LabelSource = "photo" | "sensor_derived" | "manual" | "agent"

/**
 * Priorité utilisée quand plusieurs sources couvrent le même (plante, instant).
 * Plus le nombre est élevé, plus la source est prioritaire. Une correction
 * manuelle prime toujours; sensor_derived est le dernier recours.
 */
export const LABEL_SOURCE_PRIORITY: Record<LabelSource, number> = {
  manual: 3,
  photo: 2,
  agent: 1,
  sensor_derived: 0
}

export type DerivedLabel = {
  label: number // 0-100
  confidence: number // 0-1
}

function clamp100(v: number): number {
  return Math.max(0, Math.min(100, v))
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

/**
 * Label santé déterministe à partir des seuls capteurs, pour les plantes sans
 * photo notée. Réutilise l'expert capteur engineered (`computeSensorScore`) et la
 * MÊME pénalité d'alertes que `predict` (`lib/ml/model.ts`), pour rester cohérent
 * avec le prior du modèle. Confiance volontairement basse (≤ 0.5, pondérée par la
 * fraîcheur capteur) afin que ces labels ne supplantent jamais les photos.
 *
 * Pur: fonction de `MLFeatures` uniquement (pas de Date.now, pas d'aléatoire).
 */
export function sensorDerivedLabel(f: MLFeatures): DerivedLabel {
  const base = computeSensorScore(f)
  const alertPenalty = (f.hasCriticalAlert ?? 0) * 15 + (f.openAlertCountNorm ?? 0) * 10
  const label = clamp100(base - alertPenalty)
  // Plus le signal capteur est frais, plus on fait confiance à ce label dérivé,
  // mais on plafonne à 0.5 pour rester sous les labels photo (souvent > 0.6).
  const confidence = clamp01(0.25 + 0.25 * (f.sensorFreshness ?? 0))
  return { label, confidence }
}

/**
 * Convertit un score de santé global produit par la boucle agentique LLM
 * (`agentHealthScoreSchema.overall`, 0-100) en label d'entraînement.
 */
export function agentLabel(overall: number): DerivedLabel {
  return { label: clamp100(overall), confidence: 0.6 }
}

/**
 * Valide/borne une correction de label fournie par l'utilisateur. Confiance
 * maximale: une correction manuelle est considérée comme vérité terrain.
 */
export function manualLabel(value: number): DerivedLabel {
  return { label: clamp100(value), confidence: 1 }
}
