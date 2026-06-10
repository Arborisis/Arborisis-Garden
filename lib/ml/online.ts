import type { ModelWeights, TrainingSample } from "./types"
import { expertScores, softmaxExperts, residualForward, migrateWeights, type ExpertScores } from "./net"
import { toVector, standardize, type NormStats } from "./featureVector"

/**
 * Real-time (online / incremental) learner.
 *
 * Where `trainer.ts` does heavy from-scratch batch optimization with a k-fold
 * adoption gate, this module performs cheap *continual* fine-tuning: each time a
 * fresh labeled sample lands we nudge the **already-active** model toward it so
 * predictions improve between full retrains — true temps-réel adaptation.
 *
 * Three safety properties keep it trustworthy:
 *  1. **Recency weighting** — newer samples pull harder (plants drift with the
 *     season), via an exponential half-life.
 *  2. **Anchoring (anti-forgetting)** — an L2 pull back toward the pre-update
 *     parameters so a noisy burst of samples can't wipe out learned structure.
 *  3. **Non-regression gate** — we measure weighted RMSE on the recent buffer
 *     before and after; if the update doesn't help, we roll back entirely.
 *
 * It only fine-tunes parameters the active model already has (the expert logits
 * always; the residual head's weights iff one is present with matching dims). It
 * never grows capacity — that remains the batch trainer's job.
 */

export type OnlineOptions = {
  /** Base Adam learning rate (kept small for stability). */
  lr?: number
  /** Number of passes over the recent buffer. */
  steps?: number
  /** Recency half-life in days (older samples decay toward 0 weight). */
  halfLifeDays?: number
  /** Max L2 distance the residual params may travel from their start. */
  trustRegion?: number
  /** Clamp on how far each expert logit may move. */
  maxLogitStep?: number
  /** Strength of the pull back toward the pre-update params (anti-forgetting). */
  anchorL2?: number
  /** Minimum buffer size to attempt an update. */
  minSamples?: number
}

export type OnlineResult = {
  weights: ModelWeights
  applied: boolean
  errorBefore: number
  errorAfter: number
  samples: number
  steps: number
}

type OnlinePrepared = {
  scores: ExpertScores
  vector: number[]
  label: number
  weight: number
}

const DEFAULTS = {
  lr: 0.01,
  steps: 12,
  halfLifeDays: 21,
  trustRegion: 0.75,
  maxLogitStep: 0.5,
  anchorL2: 0.02,
  minSamples: 5
}

// Huber clamp on the error gradient (same rationale as the batch trainer): a
// single mislabeled sample in the small online buffer can't yank the model.
// The non-regression gate still evaluates plain weighted RMSE.
const HUBER_DELTA = 10

// Adam constants (local — independent of the batch trainer's schedule).
const BETA1 = 0.9
const BETA2 = 0.999
const EPS = 1e-8

class Adam {
  private m: number[]
  private v: number[]
  private t = 0
  constructor(size: number) {
    this.m = new Array(size).fill(0)
    this.v = new Array(size).fill(0)
  }
  step(params: number[], grads: number[], lr: number) {
    this.t++
    const bc1 = 1 - Math.pow(BETA1, this.t)
    const bc2 = 1 - Math.pow(BETA2, this.t)
    for (let i = 0; i < params.length; i++) {
      this.m[i] = BETA1 * this.m[i] + (1 - BETA1) * grads[i]
      this.v[i] = BETA2 * this.v[i] + (1 - BETA2) * grads[i] * grads[i]
      const mHat = this.m[i] / bc1
      const vHat = this.v[i] / bc2
      params[i] -= (lr * mHat) / (Math.sqrt(vHat) + EPS)
    }
  }
}

/** Exponential recency weights (newest sample = 1), based on sampledAt. */
function recencyWeights(samples: TrainingSample[], halfLifeDays: number): number[] {
  const times = samples.map(s => new Date(s.sampledAt).getTime())
  const newest = Math.max(...times)
  const halfLifeMs = Math.max(halfLifeDays, 1e-3) * 86_400_000
  return times.map(t => {
    const ageMs = Math.max(0, newest - t)
    return Math.pow(0.5, ageMs / halfLifeMs)
  })
}

function predictPrepared(p: OnlinePrepared, w: ModelWeights): number {
  const mix = softmaxExperts(w.experts)
  const blend =
    p.scores.sensor * mix.sensor +
    p.scores.visual * mix.visual +
    p.scores.weather * mix.weather +
    p.scores.llm * mix.llm +
    p.scores.bio * mix.bio
  const { residual } = residualForward(w, p.vector)
  return Math.max(0, Math.min(100, blend + residual))
}

function weightedRmse(set: OnlinePrepared[], w: ModelWeights): number {
  let se = 0
  let wsum = 0
  for (const p of set) {
    const pred = predictPrepared(p, w)
    se += p.weight * (p.label - pred) ** 2
    wsum += p.weight
  }
  return Math.sqrt(se / Math.max(wsum, 1e-9))
}

/**
 * Fine-tune the active model on the most recent labeled samples.
 * Returns the (possibly unchanged) weights plus whether the update was kept.
 */
export function onlineUpdate(
  rawWeights: ModelWeights | unknown,
  samples: TrainingSample[],
  opts: OnlineOptions = {}
): OnlineResult {
  const o = { ...DEFAULTS, ...opts }
  const start = migrateWeights(rawWeights)

  if (samples.length < o.minSamples) {
    return { weights: start, applied: false, errorBefore: 0, errorAfter: 0, samples: samples.length, steps: 0 }
  }

  const weights = recencyWeights(samples, o.halfLifeDays)
  const norm: NormStats = start.residual.norm as NormStats
  const prepared: OnlinePrepared[] = samples.map((s, i) => {
    const scores = expertScores(s.features)
    return { scores, vector: toVector(s.features, scores), label: s.label, weight: weights[i] }
  })

  const kind = start.residual.kind
  const dim = norm.mean.length

  // Flat parameter snapshot for anchoring + rollback.
  const logits0 = [
    start.experts.sensor, start.experts.visual, start.experts.weather, start.experts.llm, start.experts.bio
  ]
  const logits = [...logits0]
  const logitAdam = new Adam(5)

  let linW: number[] = [], linW0: number[] = [], linB = 0, linB0 = 0
  let W1: number[][] = [], W1_0: number[][] = []
  let b1: number[] = [], b1_0: number[] = []
  let W2: number[] = [], W2_0: number[] = []
  let b2 = 0, b2_0 = 0
  let resAdam: Adam | null = null
  const H = kind === "mlp" ? (start.residual.W1?.length ?? 0) : 0

  if (kind === "linear" && dim > 0) {
    linW = [...(start.residual.w ?? new Array(dim).fill(0))]
    linW0 = [...linW]
    linB = start.residual.b ?? 0
    linB0 = linB
    resAdam = new Adam(dim + 1)
  } else if (kind === "mlp" && dim > 0 && H > 0) {
    W1 = (start.residual.W1 ?? []).map(r => [...r])
    W1_0 = W1.map(r => [...r])
    b1 = [...(start.residual.b1 ?? new Array(H).fill(0))]
    b1_0 = [...b1]
    W2 = [...(start.residual.W2 ?? new Array(H).fill(0))]
    W2_0 = [...W2]
    b2 = start.residual.b2 ?? 0
    b2_0 = b2
    resAdam = new Adam(H * dim + H + H + 1)
  }

  const range = start.residual.range
  const trainResidual = (kind === "linear" || kind === "mlp") && dim > 0

  const buildWeights = (): ModelWeights => ({
    version: 2,
    experts: { sensor: logits[0], visual: logits[1], weather: logits[2], llm: logits[3], bio: logits[4] },
    residual:
      kind === "linear"
        ? { kind, norm, range, w: [...linW], b: linB }
        : kind === "mlp"
        ? { kind, norm, range, W1: W1.map(r => [...r]), b1: [...b1], W2: [...W2], b2 }
        : { kind: "none", norm: start.residual.norm, range }
  })

  const wsum = prepared.reduce((a, p) => a + p.weight, 0) || 1
  const errorBefore = weightedRmse(prepared, start)

  for (let step = 0; step < o.steps; step++) {
    const mix = softmaxExperts({ sensor: logits[0], visual: logits[1], weather: logits[2], llm: logits[3], bio: logits[4] })
    const gLogits = [0, 0, 0, 0, 0]
    const gLinW = trainResidual && kind === "linear" ? new Array(dim).fill(0) : []
    let gLinB = 0
    const gW1 = trainResidual && kind === "mlp" ? W1.map(r => r.map(() => 0)) : []
    const gb1 = trainResidual && kind === "mlp" ? new Array(H).fill(0) : []
    const gW2 = trainResidual && kind === "mlp" ? new Array(H).fill(0) : []
    let gb2 = 0

    for (const p of prepared) {
      const blend =
        p.scores.sensor * mix.sensor +
        p.scores.visual * mix.visual +
        p.scores.weather * mix.weather +
        p.scores.llm * mix.llm +
        p.scores.bio * mix.bio

      const x = trainResidual ? standardize(p.vector, norm) : p.vector
      let residual = 0
      let aOut = 0
      let h: number[] = []
      if (trainResidual && kind === "linear") {
        let z = linB
        for (let j = 0; j < dim; j++) z += linW[j] * x[j]
        aOut = Math.tanh(z)
        residual = range * aOut
      } else if (trainResidual && kind === "mlp") {
        h = new Array(H)
        for (let i = 0; i < H; i++) {
          let s = b1[i]
          const row = W1[i]
          for (let j = 0; j < dim; j++) s += row[j] * x[j]
          h[i] = Math.tanh(s)
        }
        let z2 = b2
        for (let i = 0; i < H; i++) z2 += W2[i] * h[i]
        aOut = Math.tanh(z2)
        residual = range * aOut
      }

      const raw = blend + residual
      const pred = Math.max(0, Math.min(100, raw))
      const saturated = (raw <= 0 && pred === 0) || (raw >= 100 && pred === 100)
      const err = Math.max(-HUBER_DELTA, Math.min(HUBER_DELTA, pred - p.label))
      const dPred = saturated ? 0 : (p.weight * err) / wsum

      const scoresArr = [p.scores.sensor, p.scores.visual, p.scores.weather, p.scores.llm, p.scores.bio]
      const mixArr = [mix.sensor, mix.visual, mix.weather, mix.llm, mix.bio]
      for (let k = 0; k < 5; k++) gLogits[k] += dPred * mixArr[k] * (scoresArr[k] - blend)

      if (trainResidual && kind === "linear") {
        const dZ = dPred * range * (1 - aOut * aOut)
        for (let j = 0; j < dim; j++) gLinW[j] += dZ * x[j]
        gLinB += dZ
      } else if (trainResidual && kind === "mlp") {
        const dZ2 = dPred * range * (1 - aOut * aOut)
        for (let i = 0; i < H; i++) {
          gW2[i] += dZ2 * h[i]
          const dZ1 = dZ2 * W2[i] * (1 - h[i] * h[i])
          gb1[i] += dZ1
          const row = gW1[i]
          for (let j = 0; j < dim; j++) row[j] += dZ1 * x[j]
        }
        gb2 += dZ2
      }
    }

    // Anchor toward the pre-update params (anti-forgetting regularization).
    for (let k = 0; k < 5; k++) gLogits[k] += o.anchorL2 * (logits[k] - logits0[k])
    if (trainResidual && kind === "linear") {
      for (let j = 0; j < dim; j++) gLinW[j] += o.anchorL2 * (linW[j] - linW0[j])
      gLinB += o.anchorL2 * (linB - linB0)
    } else if (trainResidual && kind === "mlp") {
      for (let i = 0; i < H; i++) {
        gW2[i] += o.anchorL2 * (W2[i] - W2_0[i])
        for (let j = 0; j < dim; j++) gW1[i][j] += o.anchorL2 * (W1[i][j] - W1_0[i][j])
      }
      gb2 += o.anchorL2 * (b2 - b2_0)
    }

    logitAdam.step(logits, gLogits, o.lr)
    if (resAdam && kind === "linear") {
      const params = [...linW, linB]
      const grads = [...gLinW, gLinB]
      resAdam.step(params, grads, o.lr)
      linW = params.slice(0, dim)
      linB = params[dim]
    } else if (resAdam && kind === "mlp") {
      const params: number[] = []
      const grads: number[] = []
      for (let i = 0; i < H; i++) for (let j = 0; j < dim; j++) { params.push(W1[i][j]); grads.push(gW1[i][j]) }
      for (let i = 0; i < H; i++) { params.push(b1[i]); grads.push(gb1[i]) }
      for (let i = 0; i < H; i++) { params.push(W2[i]); grads.push(gW2[i]) }
      params.push(b2); grads.push(gb2)
      resAdam.step(params, grads, o.lr)
      let ptr = 0
      for (let i = 0; i < H; i++) for (let j = 0; j < dim; j++) W1[i][j] = params[ptr++]
      for (let i = 0; i < H; i++) b1[i] = params[ptr++]
      for (let i = 0; i < H; i++) W2[i] = params[ptr++]
      b2 = params[ptr++]
    }
  }

  // --- Trust region: clamp how far we drifted from the starting point ---
  for (let k = 0; k < 5; k++) {
    const d = logits[k] - logits0[k]
    if (Math.abs(d) > o.maxLogitStep) logits[k] = logits0[k] + Math.sign(d) * o.maxLogitStep
  }
  if (trainResidual) {
    let sq = 0
    if (kind === "linear") {
      for (let j = 0; j < dim; j++) sq += (linW[j] - linW0[j]) ** 2
      sq += (linB - linB0) ** 2
    } else {
      for (let i = 0; i < H; i++) {
        for (let j = 0; j < dim; j++) sq += (W1[i][j] - W1_0[i][j]) ** 2
        sq += (b1[i] - b1_0[i]) ** 2
        sq += (W2[i] - W2_0[i]) ** 2
      }
      sq += (b2 - b2_0) ** 2
    }
    const dist = Math.sqrt(sq)
    if (dist > o.trustRegion && dist > 0) {
      const scale = o.trustRegion / dist
      if (kind === "linear") {
        for (let j = 0; j < dim; j++) linW[j] = linW0[j] + (linW[j] - linW0[j]) * scale
        linB = linB0 + (linB - linB0) * scale
      } else {
        for (let i = 0; i < H; i++) {
          for (let j = 0; j < dim; j++) W1[i][j] = W1_0[i][j] + (W1[i][j] - W1_0[i][j]) * scale
          b1[i] = b1_0[i] + (b1[i] - b1_0[i]) * scale
          W2[i] = W2_0[i] + (W2[i] - W2_0[i]) * scale
        }
        b2 = b2_0 + (b2 - b2_0) * scale
      }
    }
  }

  const candidate = buildWeights()
  const errorAfter = weightedRmse(prepared, candidate)

  // Non-regression gate: keep the update only if it improved the recent buffer.
  if (errorAfter <= errorBefore + 1e-9) {
    return { weights: candidate, applied: true, errorBefore, errorAfter, samples: prepared.length, steps: o.steps }
  }
  return { weights: start, applied: false, errorBefore, errorAfter, samples: prepared.length, steps: o.steps }
}
