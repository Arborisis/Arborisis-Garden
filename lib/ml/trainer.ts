import type { ModelWeights, TrainingSample, ResidualHead } from "./types"
import { expertScores, softmaxExperts, residualForward, migrateWeights, type ExpertScores } from "./net"
import { toVector, fitNorm, standardize, INPUT_DIM, type NormStats } from "./featureVector"

export type TrainingResult = {
  weights: ModelWeights
  rmse: number
  mae: number
  valRmse: number
  sampleCount: number
  epochs: number
  residualKind: ResidualHead["kind"]
  adopted: boolean
}

const RESIDUAL_RANGE = 25
const PATIENCE = 80
const WARMUP = 60 // don't early-stop before the residual has had time to move

// Recency weighting: recent labels matter more (plants drift with the season),
// so each sample is weighted by an exponential half-life on its age. The CV gate
// and early-stopping RMSE stay UNWEIGHTED, so this only shapes the fit — it can
// never sneak a worse-generalizing model past the non-regression guarantee.
const RECENCY_HALF_LIFE_DAYS = 45

// Adoption gate (k-fold cross-validated): only replace the safe prior when the
// trained model generalizes better by both a relative and an absolute margin.
const ADOPT_MARGIN = 0.985
const ADOPT_ABS = 0.3
const KFOLDS = 5

// Adam hyperparameters
const LR = 0.03
const BETA1 = 0.9
const BETA2 = 0.999
const EPS = 1e-8

// Ridge-style L2: scaled by params/samples so the residual is strongly shrunk
// when data is scarce relative to its capacity, and lightly when data is rich.
const L2_BASE = 0.08
const L2_MIN = 2e-3
const L2_MAX = 0.4
const L2_LOGITS = 1e-3

function effectiveL2(paramCount: number, nTrain: number): number {
  const ratio = paramCount / Math.max(nTrain, 1)
  return Math.max(L2_MIN, Math.min(L2_MAX, L2_BASE * ratio))
}

// Capacity grows with data so we never fit a head we can't cross-validate.
const MIN_VALIDATABLE = 16 // below this we keep the prior untouched
function chooseKind(n: number): ResidualHead["kind"] {
  if (n < 30) return "none"    // only learn the 5-param expert mixture
  if (n < 100) return "linear" // ridge-regularized linear correction
  return "mlp"
}

// MLP width also grows with data: a wider hidden layer captures richer
// non-linear interactions once we have enough samples to cross-validate it.
function chooseHidden(n: number): number {
  if (n < 250) return 6
  if (n < 600) return 10
  return 16
}

function paramCountFor(kind: ResidualHead["kind"], hidden: number): number {
  if (kind === "linear") return INPUT_DIM + 1
  if (kind === "mlp") return hidden * INPUT_DIM + hidden + hidden + 1
  return 0
}

type Prepared = { scores: ExpertScores; vector: number[]; label: number; weight: number }

/** Adam optimizer over a flat parameter array. */
class Adam {
  m: number[]
  v: number[]
  t = 0
  constructor(size: number) {
    this.m = new Array(size).fill(0)
    this.v = new Array(size).fill(0)
  }
  step(params: number[], grads: number[]) {
    this.t++
    const bc1 = 1 - Math.pow(BETA1, this.t)
    const bc2 = 1 - Math.pow(BETA2, this.t)
    for (let i = 0; i < params.length; i++) {
      this.m[i] = BETA1 * this.m[i] + (1 - BETA1) * grads[i]
      this.v[i] = BETA2 * this.v[i] + (1 - BETA2) * grads[i] * grads[i]
      const mHat = this.m[i] / bc1
      const vHat = this.v[i] / bc2
      params[i] -= (LR * mHat) / (Math.sqrt(vHat) + EPS)
    }
  }
}

/** Health prediction for a prepared sample under given weights (clamped 0-100). */
function evalHealthW(p: Prepared, w: ModelWeights): number {
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

function rmseMae(set: Prepared[], evalFn: (p: Prepared) => number) {
  let se = 0, ae = 0
  for (const p of set) {
    const pred = evalFn(p)
    se += (p.label - pred) ** 2
    ae += Math.abs(p.label - pred)
  }
  const n = Math.max(set.length, 1)
  return { rmse: Math.sqrt(se / n), mae: ae / n }
}

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Train one model of the given capacity on `fitSet`, using `valSet` for early
 * stopping. Warm-starts the expert mixture from `init`. Returns the
 * best-by-validation weights plus the validation RMSE and epochs run.
 */
function fitModel(
  fitSet: Prepared[],
  valSet: Prepared[],
  kind: ResidualHead["kind"],
  hidden: number,
  init: ModelWeights,
  maxEpochs: number
): { weights: ModelWeights; valRmse: number; epochs: number } {
  const norm: NormStats = kind === "none" ? { mean: [], std: [] } : fitNorm(fitSet.map(p => p.vector))
  const l2 = effectiveL2(paramCountFor(kind, hidden), fitSet.length)
  const HIDDEN_DIM = hidden
  // Sum of recency weights → normalizer for the weighted gradient (so the overall
  // step size stays comparable to the unweighted mean regardless of the weights).
  const wsum = fitSet.reduce((a, p) => a + p.weight, 0) || 1

  const logits = [init.experts.sensor, init.experts.visual, init.experts.weather, init.experts.llm, init.experts.bio]
  const logitAdam = new Adam(5)

  let linW: number[] = [], linB = 0
  let W1: number[][] = [], b1: number[] = [], W2: number[] = [], b2 = 0
  let linAdam: Adam | null = null
  let mlpAdam: Adam | null = null

  if (kind === "linear") {
    linW = new Array(INPUT_DIM).fill(0)
    linAdam = new Adam(INPUT_DIM + 1)
  } else if (kind === "mlp") {
    const xavier = Math.sqrt(1 / INPUT_DIM)
    W1 = Array.from({ length: HIDDEN_DIM }, () =>
      Array.from({ length: INPUT_DIM }, () => (Math.random() * 2 - 1) * xavier)
    )
    b1 = new Array(HIDDEN_DIM).fill(0)
    W2 = new Array(HIDDEN_DIM).fill(0) // start at 0 → residual 0 → expert prior
    mlpAdam = new Adam(HIDDEN_DIM * INPUT_DIM + HIDDEN_DIM + HIDDEN_DIM + 1)
  }

  const buildWeights = (): ModelWeights => {
    const residual: ResidualHead =
      kind === "none"
        ? { kind, norm: { mean: [], std: [] }, range: RESIDUAL_RANGE }
        : kind === "linear"
        ? { kind, norm, range: RESIDUAL_RANGE, w: [...linW], b: linB }
        : { kind, norm, range: RESIDUAL_RANGE, W1: W1.map(r => [...r]), b1: [...b1], W2: [...W2], b2 }
    return {
      version: 2,
      experts: { sensor: logits[0], visual: logits[1], weather: logits[2], llm: logits[3], bio: logits[4] },
      residual
    }
  }

  const evalSet = valSet.length > 0 ? valSet : fitSet
  let bestValRmse = Infinity
  let bestWeights = buildWeights()
  let patience = 0
  let ranEpochs = 0

  for (let epoch = 0; epoch < maxEpochs; epoch++) {
    ranEpochs = epoch + 1

    const gLogits = [0, 0, 0, 0, 0]
    const gLinW = kind === "linear" ? new Array(INPUT_DIM).fill(0) : []
    let gLinB = 0
    const gW1 = kind === "mlp" ? W1.map(r => r.map(() => 0)) : []
    const gb1 = kind === "mlp" ? new Array(HIDDEN_DIM).fill(0) : []
    const gW2 = kind === "mlp" ? new Array(HIDDEN_DIM).fill(0) : []
    let gb2 = 0

    const mix = softmaxExperts({ sensor: logits[0], visual: logits[1], weather: logits[2], llm: logits[3], bio: logits[4] })

    for (const p of fitSet) {
      const blend =
        p.scores.sensor * mix.sensor +
        p.scores.visual * mix.visual +
        p.scores.weather * mix.weather +
        p.scores.llm * mix.llm +
        p.scores.bio * mix.bio

      const x = kind === "none" ? p.vector : standardize(p.vector, norm)

      let residual = 0
      let aOut = 0, h: number[] = []
      if (kind === "linear") {
        let z = linB
        for (let j = 0; j < INPUT_DIM; j++) z += linW[j] * x[j]
        aOut = Math.tanh(z)
        residual = RESIDUAL_RANGE * aOut
      } else if (kind === "mlp") {
        h = new Array(HIDDEN_DIM)
        for (let i = 0; i < HIDDEN_DIM; i++) {
          let s = b1[i]
          const row = W1[i]
          for (let j = 0; j < INPUT_DIM; j++) s += row[j] * x[j]
          h[i] = Math.tanh(s)
        }
        let z2 = b2
        for (let i = 0; i < HIDDEN_DIM; i++) z2 += W2[i] * h[i]
        aOut = Math.tanh(z2)
        residual = RESIDUAL_RANGE * aOut
      }

      const raw = blend + residual
      const pred = Math.max(0, Math.min(100, raw))
      const saturated = (raw <= 0 && pred === 0) || (raw >= 100 && pred === 100)
      const dPred = saturated ? 0 : (p.weight * (pred - p.label)) / wsum

      const scoresArr = [p.scores.sensor, p.scores.visual, p.scores.weather, p.scores.llm, p.scores.bio]
      const mixArr = [mix.sensor, mix.visual, mix.weather, mix.llm, mix.bio]
      for (let k = 0; k < 5; k++) gLogits[k] += dPred * mixArr[k] * (scoresArr[k] - blend)

      if (kind === "linear") {
        const dZ = dPred * RESIDUAL_RANGE * (1 - aOut * aOut)
        for (let j = 0; j < INPUT_DIM; j++) gLinW[j] += dZ * x[j]
        gLinB += dZ
      } else if (kind === "mlp") {
        const dZ2 = dPred * RESIDUAL_RANGE * (1 - aOut * aOut)
        for (let i = 0; i < HIDDEN_DIM; i++) {
          gW2[i] += dZ2 * h[i]
          const dZ1 = dZ2 * W2[i] * (1 - h[i] * h[i])
          gb1[i] += dZ1
          const row = gW1[i]
          for (let j = 0; j < INPUT_DIM; j++) row[j] += dZ1 * x[j]
        }
        gb2 += dZ2
      }
    }

    // L2 regularization
    for (let k = 0; k < 5; k++) gLogits[k] += L2_LOGITS * logits[k]
    if (kind === "linear") {
      for (let j = 0; j < INPUT_DIM; j++) gLinW[j] += l2 * linW[j]
    } else if (kind === "mlp") {
      for (let i = 0; i < HIDDEN_DIM; i++) {
        gW2[i] += l2 * W2[i]
        for (let j = 0; j < INPUT_DIM; j++) gW1[i][j] += l2 * W1[i][j]
      }
    }

    // Adam updates
    logitAdam.step(logits, gLogits)
    if (kind === "linear" && linAdam) {
      const params = [...linW, linB]
      const grads = [...gLinW, gLinB]
      linAdam.step(params, grads)
      linW = params.slice(0, INPUT_DIM)
      linB = params[INPUT_DIM]
    } else if (kind === "mlp" && mlpAdam) {
      const params: number[] = []
      const grads: number[] = []
      for (let i = 0; i < HIDDEN_DIM; i++) for (let j = 0; j < INPUT_DIM; j++) { params.push(W1[i][j]); grads.push(gW1[i][j]) }
      for (let i = 0; i < HIDDEN_DIM; i++) { params.push(b1[i]); grads.push(gb1[i]) }
      for (let i = 0; i < HIDDEN_DIM; i++) { params.push(W2[i]); grads.push(gW2[i]) }
      params.push(b2); grads.push(gb2)
      mlpAdam.step(params, grads)
      let ptr = 0
      for (let i = 0; i < HIDDEN_DIM; i++) for (let j = 0; j < INPUT_DIM; j++) W1[i][j] = params[ptr++]
      for (let i = 0; i < HIDDEN_DIM; i++) b1[i] = params[ptr++]
      for (let i = 0; i < HIDDEN_DIM; i++) W2[i] = params[ptr++]
      b2 = params[ptr++]
    }

    // Early stopping on the held-out set
    const current = buildWeights()
    const { rmse: valRmse } = rmseMae(evalSet, p => evalHealthW(p, current))
    if (valRmse < bestValRmse - 1e-4) {
      bestValRmse = valRmse
      bestWeights = current
      patience = 0
    } else if (valSet.length > 0 && epoch >= WARMUP) {
      patience++
      if (patience >= PATIENCE) break
    }
  }

  return { weights: bestWeights, valRmse: bestValRmse, epochs: ranEpochs }
}

export function trainWeights(
  initial: ModelWeights | unknown,
  samples: TrainingSample[],
  maxEpochs = 300
): TrainingResult {
  const init = migrateWeights(initial)
  if (samples.length === 0) {
    return { weights: init, rmse: 0, mae: 0, valRmse: 0, sampleCount: 0, epochs: 0, residualKind: "none", adopted: false }
  }

  // Exponential recency weights (newest sample = 1).
  const times = samples.map(s => new Date(s.sampledAt).getTime())
  const newest = times.length ? Math.max(...times) : Date.now()
  const halfLifeMs = RECENCY_HALF_LIFE_DAYS * 86_400_000
  const prepared: Prepared[] = samples.map((s, i) => {
    const scores = expertScores(s.features)
    const age = Math.max(0, newest - times[i])
    return {
      scores,
      vector: toVector(s.features, scores),
      label: s.label,
      weight: Math.pow(0.5, age / halfLifeMs)
    }
  })

  const n = prepared.length
  const kind = chooseKind(n)
  const hidden = chooseHidden(n)

  const priorMetrics = () => rmseMae(prepared, p => evalHealthW(p, init))

  // Not enough data to cross-validate → keep the prior untouched.
  if (n < MIN_VALIDATABLE) {
    const m = priorMetrics()
    return {
      weights: init, rmse: m.rmse, mae: m.mae, valRmse: m.rmse,
      sampleCount: n, epochs: 0, residualKind: init.residual.kind, adopted: false
    }
  }

  // ---- K-fold cross-validated adoption gate ----
  // Estimate out-of-fold generalization of the trained model vs the safe prior.
  // Only the comparison uses CV; we never trust a single noisy holdout.
  const shuffledSet = shuffled(prepared)
  const k = Math.min(KFOLDS, Math.max(2, Math.floor(n / 6)))
  let cvTrainedSe = 0, cvPriorSe = 0, cvCount = 0
  for (let f = 0; f < k; f++) {
    const fold = shuffledSet.filter((_, i) => i % k === f)
    const rest = shuffledSet.filter((_, i) => i % k !== f)
    if (fold.length === 0 || rest.length === 0) continue
    // inner holdout from rest for early stopping
    const innerVal = rest.slice(0, Math.max(2, Math.round(rest.length * 0.2)))
    const innerTrain = rest.slice(innerVal.length)
    const { weights } = fitModel(innerTrain.length ? innerTrain : rest, innerVal, kind, hidden, init, maxEpochs)
    for (const p of fold) {
      cvTrainedSe += (p.label - evalHealthW(p, weights)) ** 2
      cvPriorSe += (p.label - evalHealthW(p, init)) ** 2
      cvCount++
    }
  }
  const cvTrained = Math.sqrt(cvTrainedSe / Math.max(cvCount, 1))
  const cvPrior = Math.sqrt(cvPriorSe / Math.max(cvCount, 1))
  const adopted = cvTrained <= cvPrior * ADOPT_MARGIN && cvTrained <= cvPrior - ADOPT_ABS

  if (!adopted) {
    const m = priorMetrics()
    return {
      weights: init, rmse: m.rmse, mae: m.mae, valRmse: cvPrior,
      sampleCount: n, epochs: 0, residualKind: init.residual.kind, adopted: false
    }
  }

  // ---- Adopted: final fit on all data with an internal early-stopping holdout ----
  const finalVal = shuffledSet.slice(0, Math.max(4, Math.round(n * 0.2)))
  const finalTrain = shuffledSet.slice(finalVal.length)
  const { weights, epochs } = fitModel(finalTrain, finalVal, kind, hidden, init, maxEpochs)
  const train = rmseMae(prepared, p => evalHealthW(p, weights))

  return {
    weights,
    rmse: train.rmse,
    mae: train.mae,
    valRmse: cvTrained,
    sampleCount: n,
    epochs,
    residualKind: kind,
    adopted: true
  }
}
