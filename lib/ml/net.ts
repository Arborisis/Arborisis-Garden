import type { MLFeatures, ModelWeights, ExpertLogits, LegacyWeights, TrainMeta } from "./types"
import { DEFAULT_WEIGHTS } from "./types"
import {
  computeSensorScore,
  computeWeatherRisk,
  computeVisualScore,
  computeLlmConsensus,
  computeBioScore
} from "./scoring"
import { toVector, standardize, identityNorm, INPUT_DIM, type NormStats } from "./featureVector"

export type ExpertScores = { sensor: number; visual: number; weather: number; llm: number; bio: number }

/** The 5 engineered domain expert scores (0-100). weather is 100 - risk. */
export function expertScores(f: MLFeatures): ExpertScores {
  return {
    sensor: computeSensorScore(f),
    visual: computeVisualScore(f),
    weather: 100 - computeWeatherRisk(f),
    llm: computeLlmConsensus(f),
    bio: computeBioScore(f)
  }
}

/** Numerically stable softmax over the 5 expert logits → mixture weights. */
export function softmaxExperts(logits: ExpertLogits): ExpertScores {
  const arr = [logits.sensor, logits.visual, logits.weather, logits.llm, logits.bio]
  const max = Math.max(...arr)
  const exp = arr.map(v => Math.exp(v - max))
  const sum = exp.reduce((a, b) => a + b, 0) || 1
  return {
    sensor: exp[0] / sum,
    visual: exp[1] / sum,
    weather: exp[2] / sum,
    llm: exp[3] / sum,
    bio: exp[4] / sum
  }
}

export function expertBlend(scores: ExpertScores, mix: ExpertScores): number {
  return (
    scores.sensor * mix.sensor +
    scores.visual * mix.visual +
    scores.weather * mix.weather +
    scores.llm * mix.llm +
    scores.bio * mix.bio
  )
}

const tanh = Math.tanh

/**
 * Residual head forward pass. Returns the correction in health points and the
 * cached activations needed for backprop (used by the trainer).
 */
export function residualForward(
  weights: ModelWeights,
  vector: number[]
): { residual: number; cache?: ResidualCache } {
  const r = weights.residual
  if (r.kind === "none") return { residual: 0 }

  const norm: NormStats =
    r.norm.mean.length === vector.length ? (r.norm as NormStats) : identityNorm()
  const x = standardize(vector, norm)

  if (r.kind === "linear") {
    const w = r.w ?? []
    let z = r.b ?? 0
    for (let j = 0; j < x.length; j++) z += (w[j] ?? 0) * x[j]
    const a = tanh(z)
    return { residual: r.range * a, cache: { x, z, a } }
  }

  // mlp
  const W1 = r.W1 ?? []
  const b1 = r.b1 ?? []
  const W2 = r.W2 ?? []
  const H = W1.length
  const h = new Array(H)
  const z1 = new Array(H)
  for (let i = 0; i < H; i++) {
    let s = b1[i] ?? 0
    const row = W1[i]
    for (let j = 0; j < x.length; j++) s += (row[j] ?? 0) * x[j]
    z1[i] = s
    h[i] = tanh(s)
  }
  let z2 = r.b2 ?? 0
  for (let i = 0; i < H; i++) z2 += (W2[i] ?? 0) * h[i]
  const a = tanh(z2)
  return { residual: r.range * a, cache: { x, z1, h, z2, a } }
}

export type ResidualCache = {
  x: number[]
  // linear
  z?: number
  // mlp
  z1?: number[]
  h?: number[]
  z2?: number
  a: number
}

/**
 * Full forward pass → health score (0-100), reusing expert scores if provided.
 */
export function forward(
  weights: ModelWeights,
  f: MLFeatures,
  precomputed?: { scores: ExpertScores; vector: number[] }
): {
  health: number
  scores: ExpertScores
  mix: ExpertScores
  blend: number
  residual: number
} {
  const scores = precomputed?.scores ?? expertScores(f)
  const mix = softmaxExperts(weights.experts)
  const blend = expertBlend(scores, mix)
  const vector = precomputed?.vector ?? toVector(f, scores)
  const { residual } = residualForward(weights, vector)
  const health = Math.max(0, Math.min(100, blend + residual))
  return { health, scores, mix, blend, residual }
}

/**
 * Accept legacy v1 weights ({sensor,visual,weather,llm} summing to 1) or the new
 * v2 structure, always returning a valid v2 ModelWeights.
 */
/**
 * Back-fill any missing expert logit (notably `bio`, added after some weights
 * were already serialized) with the safe default so older models keep working.
 */
function normalizeExperts(raw: unknown): ExpertLogits {
  const e = (raw ?? {}) as Partial<ExpertLogits>
  return {
    sensor: typeof e.sensor === "number" ? e.sensor : DEFAULT_WEIGHTS.experts.sensor,
    visual: typeof e.visual === "number" ? e.visual : DEFAULT_WEIGHTS.experts.visual,
    weather: typeof e.weather === "number" ? e.weather : DEFAULT_WEIGHTS.experts.weather,
    llm: typeof e.llm === "number" ? e.llm : DEFAULT_WEIGHTS.experts.llm,
    bio: typeof e.bio === "number" ? e.bio : DEFAULT_WEIGHTS.experts.bio
  }
}

function normalizeMeta(raw: unknown): TrainMeta | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const m = raw as Partial<TrainMeta>
  if (typeof m.valRmse !== "number" || !Number.isFinite(m.valRmse)) return undefined
  return {
    valRmse: m.valRmse,
    sampleCount: typeof m.sampleCount === "number" ? m.sampleCount : 0,
    trainedAt: typeof m.trainedAt === "string" ? m.trainedAt : ""
  }
}

export function migrateWeights(raw: unknown): ModelWeights {
  if (!raw || typeof raw !== "object") return DEFAULT_WEIGHTS
  const obj = raw as Record<string, unknown>

  if (obj.version === 2 && obj.experts && obj.residual) {
    const r = obj.residual as ModelWeights["residual"]
    const kind = r.kind ?? "none"
    const meta = normalizeMeta(obj.meta)
    // Garde-fou: si la tete residuelle a ete entrainee sur un nombre de features
    // different (ex: ajout de l'expert bio), ses poids ne sont plus alignes.
    // On retombe sur le melange d'experts (sur) jusqu'au prochain entrainement.
    const storedDim = r.norm?.mean?.length ?? 0
    const dimMismatch = kind !== "none" && storedDim !== INPUT_DIM
    if (dimMismatch) {
      return {
        version: 2,
        experts: normalizeExperts(obj.experts),
        residual: { kind: "none", norm: { mean: [], std: [] }, range: r.range ?? 25 }
      }
    }
    return {
      version: 2,
      experts: normalizeExperts(obj.experts),
      residual: {
        kind,
        norm: r.norm ?? { mean: [], std: [] },
        range: r.range ?? 25,
        w: r.w,
        b: r.b,
        W1: r.W1,
        b1: r.b1,
        W2: r.W2,
        b2: r.b2
      },
      ...(meta ? { meta } : {})
    }
  }

  // Legacy: convert blend weights → softmax logits (log of normalized weights).
  const legacy = obj as Partial<LegacyWeights>
  if (
    typeof legacy.sensor === "number" &&
    typeof legacy.visual === "number" &&
    typeof legacy.weather === "number" &&
    typeof legacy.llm === "number"
  ) {
    const eps = 1e-4
    return {
      version: 2,
      experts: {
        sensor: Math.log(Math.max(legacy.sensor, eps)),
        visual: Math.log(Math.max(legacy.visual, eps)),
        weather: Math.log(Math.max(legacy.weather, eps)),
        llm: Math.log(Math.max(legacy.llm, eps)),
        bio: DEFAULT_WEIGHTS.experts.bio
      },
      residual: { kind: "none", norm: { mean: [], std: [] }, range: 25 }
    }
  }

  return DEFAULT_WEIGHTS
}
