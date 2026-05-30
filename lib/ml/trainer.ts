import type { ModelWeights, TrainingSample } from "./types"
import {
  computeSensorScore,
  computeWeatherRisk,
  computeVisualScore,
  computeLlmConsensus
} from "./scoring"

const LEARNING_RATE = 0.008
const MIN_WEIGHT = 0.05
const MAX_WEIGHT = 0.70

export type TrainingResult = {
  weights: ModelWeights
  rmse: number
  mae: number
  sampleCount: number
  epochs: number
}

function clusterScores(w: ModelWeights, sample: TrainingSample) {
  const f = sample.features
  return {
    sensor: computeSensorScore(f),
    visual: computeVisualScore(f),
    weather: 100 - computeWeatherRisk(f),
    llm: computeLlmConsensus(f)
  }
}

function ensemble(w: ModelWeights, scores: ReturnType<typeof clusterScores>): number {
  return (
    scores.sensor * w.sensor +
    scores.visual * w.visual +
    scores.weather * w.weather +
    scores.llm * w.llm
  )
}

function normalizeWeights(w: ModelWeights): ModelWeights {
  const total = w.sensor + w.visual + w.weather + w.llm
  return {
    sensor: w.sensor / total,
    visual: w.visual / total,
    weather: w.weather / total,
    llm: w.llm / total
  }
}

function clampWeights(w: ModelWeights): ModelWeights {
  const clamped = {
    sensor: Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, w.sensor)),
    visual: Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, w.visual)),
    weather: Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, w.weather)),
    llm: Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, w.llm))
  }
  return normalizeWeights(clamped)
}

export function trainWeights(
  initial: ModelWeights,
  samples: TrainingSample[],
  epochs = 30
): TrainingResult {
  if (samples.length === 0) {
    return { weights: initial, rmse: 0, mae: 0, sampleCount: 0, epochs: 0 }
  }

  let w = { ...initial }

  // Pre-compute cluster scores (they don't change with weights)
  const precomputed = samples.map(s => ({
    scores: clusterScores(w, s),
    label: s.label
  }))

  for (let epoch = 0; epoch < epochs; epoch++) {
    // Shuffle for stochastic gradient descent
    for (let i = precomputed.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [precomputed[i], precomputed[j]] = [precomputed[j], precomputed[i]]
    }

    for (const { scores, label } of precomputed) {
      const pred = ensemble(w, scores)
      const error = (label - pred) / 100  // normalize to 0-1 scale

      w = {
        sensor: w.sensor + LEARNING_RATE * error * scores.sensor / 100,
        visual: w.visual + LEARNING_RATE * error * scores.visual / 100,
        weather: w.weather + LEARNING_RATE * error * scores.weather / 100,
        llm: w.llm + LEARNING_RATE * error * scores.llm / 100
      }
      w = clampWeights(w)
    }
  }

  // Final metrics
  let se = 0, ae = 0
  for (const { scores, label } of precomputed) {
    const pred = ensemble(w, scores)
    se += (label - pred) ** 2
    ae += Math.abs(label - pred)
  }

  return {
    weights: w,
    rmse: Math.sqrt(se / samples.length),
    mae: ae / samples.length,
    sampleCount: samples.length,
    epochs
  }
}
