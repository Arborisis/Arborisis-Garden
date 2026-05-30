"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  Droplets,
  FlaskConical,
  Layers,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Zap
} from "lucide-react";

type MLPrediction = {
  healthScore: number;
  stressLevel: "healthy" | "watch" | "moderate_stress" | "critical";
  wateringUrgencyHours: number | null;
  confidenceScore: number;
  breakdown: {
    sensorScore: number;
    visualScore: number;
    weatherRisk: number;
    llmConsensus: number;
  };
  dominantSignals: string[];
  generatedAt: string;
};

type ModelVersion = {
  version: string;
  trainedAt: string | null;
  sampleCount: number;
  isActive: boolean;
  weights: { sensor: number; visual: number; weather: number; llm: number };
  metrics: { rmse: number; mae: number; epochs: number } | null;
};

type MLState = {
  prediction: MLPrediction | null;
  modelVersion: { version: string; trainedAt: string | null; sampleCount: number } | null;
  weights: { sensor: number; visual: number; weather: number; llm: number } | null;
  features: {
    sensorFreshness: number;
    moisturePct: number;
    targetMoisturePct: number;
    moistureSlopePctPerHour: number;
    photoHealth: number;
    photoConfidence: number;
  } | null;
};

type TrainState = {
  sampleCount: number;
  versions: ModelVersion[];
};

const STRESS_LABELS: Record<string, string> = {
  healthy: "Saine",
  watch: "Surveillance",
  moderate_stress: "Stress modéré",
  critical: "Critique"
};

const STRESS_COLORS: Record<string, string> = {
  healthy: "var(--leaf)",
  watch: "var(--moss)",
  moderate_stress: "var(--sun)",
  critical: "var(--danger)"
};

function scoreColor(score: number): string {
  if (score >= 75) return "var(--leaf)";
  if (score >= 50) return "var(--moss)";
  if (score >= 30) return "var(--sun)";
  return "var(--danger)";
}

function Bar({ value, color, label }: { value: number; color: string; label: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="mlBar">
      <div className="mlBarLabel">
        <span>{label}</span>
        <span style={{ color }}>{Math.round(pct)}</span>
      </div>
      <div className="mlBarTrack">
        <div className="mlBarFill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function WeightPill({
  label,
  value,
  color
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="mlWeightPill">
      <span className="mlWeightDot" style={{ background: color }} />
      <span className="mlWeightLabel">{label}</span>
      <strong className="mlWeightValue" style={{ color }}>
        {Math.round(value * 100)}%
      </strong>
    </div>
  );
}

function HealthRing({ score, stress }: { score: number; stress: string }) {
  const color = scoreColor(score);
  const r = 44;
  const circ = 2 * Math.PI * r;
  const fill = circ * (1 - score / 100);
  return (
    <div className="mlHealthRing">
      <svg viewBox="0 0 100 100" width={100} height={100} aria-hidden="true">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(74,222,128,0.08)" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeDasharray={circ}
          strokeDashoffset={fill}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
          style={{ transition: "stroke-dashoffset 0.6s ease, stroke 0.4s ease" }}
        />
        <text x="50" y="46" textAnchor="middle" fill={color} fontSize="18" fontWeight="700" fontFamily="Inter, sans-serif">
          {Math.round(score)}
        </text>
        <text x="50" y="60" textAnchor="middle" fill="var(--muted)" fontSize="8" fontFamily="Inter, sans-serif">
          /100
        </text>
      </svg>
      <span className="mlStressLabel" style={{ color }}>
        {STRESS_LABELS[stress] ?? stress}
      </span>
    </div>
  );
}

export function MLIntelligencePanel({
  plantId,
  weatherLocation,
  timezone
}: {
  plantId: string;
  weatherLocation?: string;
  timezone?: string;
}) {
  const [state, setState] = useState<MLState>({
    prediction: null,
    modelVersion: null,
    weights: null,
    features: null
  });
  const [trainState, setTrainState] = useState<TrainState | null>(null);
  const [loading, setLoading] = useState(false);
  const [trainBusy, setTrainBusy] = useState(false);
  const [collectBusy, setCollectBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [showFeatures, setShowFeatures] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchPrediction = useCallback(async () => {
    if (!plantId) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setStatus("Analyse en cours...");
    try {
      const params = new URLSearchParams({ plantId });
      if (weatherLocation) params.set("weatherLocation", weatherLocation);
      if (timezone) params.set("timezone", timezone);
      const res = await fetch(`/api/ml/predict?${params}`, { signal: abortRef.current.signal });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json() as {
        prediction: MLPrediction;
        modelVersion: MLState["modelVersion"];
        weights: MLState["weights"];
        features: MLState["features"];
      };
      setState({ prediction: data.prediction, modelVersion: data.modelVersion, weights: data.weights, features: data.features });
      setStatus("");
    } catch (err) {
      if ((err as Error).name !== "AbortError") setStatus("Erreur de prédiction");
    } finally {
      setLoading(false);
    }
  }, [plantId, weatherLocation, timezone]);

  const fetchTrainState = useCallback(async () => {
    const res = await fetch("/api/ml/train");
    if (!res.ok) return;
    const data = await res.json() as TrainState;
    setTrainState(data);
  }, []);

  useEffect(() => {
    void fetchPrediction();
    void fetchTrainState();
  }, [fetchPrediction, fetchTrainState]);

  const collect = async () => {
    setCollectBusy(true);
    setStatus("Collecte des données d'entraînement...");
    try {
      const res = await fetch("/api/ml/collect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plantId }) });
      const data = await res.json() as { created?: number; message?: string; error?: string };
      if (!res.ok) setStatus(data.error ?? "Erreur collect");
      else {
        setStatus(data.message ?? `${data.created ?? 0} échantillon(s) collecté(s)`);
        await fetchTrainState();
      }
    } catch {
      setStatus("Erreur réseau");
    } finally {
      setCollectBusy(false);
    }
  };

  const train = async () => {
    setTrainBusy(true);
    setStatus("Entraînement du modèle...");
    try {
      const res = await fetch("/api/ml/train", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ epochs: 30 }) });
      const data = await res.json() as { version?: string; metrics?: { rmse: number; mae: number }; error?: string; message?: string };
      if (!res.ok) setStatus(data.message ?? data.error ?? "Erreur training");
      else {
        setStatus(`Modèle ${data.version ?? ""} entraîné — RMSE ${(data.metrics?.rmse ?? 0).toFixed(2)}`);
        await Promise.all([fetchPrediction(), fetchTrainState()]);
      }
    } catch {
      setStatus("Erreur réseau");
    } finally {
      setTrainBusy(false);
    }
  };

  const { prediction, modelVersion, weights, features } = state;
  const busy = trainBusy || collectBusy;

  return (
    <section className="panel mlPanel">
      {/* Header */}
      <div className="panelHeader">
        <div>
          <h2>ML Intelligence</h2>
          {modelVersion && (
            <p className="small muted">
              {modelVersion.version === "default" ? "Poids par défaut" : modelVersion.version}
              {" · "}
              {modelVersion.sampleCount} échantillon{modelVersion.sampleCount !== 1 ? "s" : ""}
            </p>
          )}
        </div>
        <div className="mlHeaderActions">
          <button className="iconButton smallIcon" onClick={fetchPrediction} disabled={loading} aria-label="Rafraîchir" title="Rafraîchir la prédiction">
            <RefreshCw size={16} className={loading ? "spinning" : ""} />
          </button>
          <BrainCircuit size={18} />
        </div>
      </div>

      {/* Health Score Ring + Urgency */}
      {prediction ? (
        <div className="mlScoreSection">
          <HealthRing score={prediction.healthScore} stress={prediction.stressLevel} />
          <div className="mlScoreMeta">
            <div className="mlConfidence">
              <span className="muted">Confiance</span>
              <strong style={{ color: scoreColor(prediction.confidenceScore * 100) }}>
                {Math.round(prediction.confidenceScore * 100)}%
              </strong>
            </div>
            {prediction.wateringUrgencyHours !== null ? (
              <div className="mlUrgencyBadge" data-urgent={prediction.wateringUrgencyHours < 6}>
                <Droplets size={14} />
                <div>
                  <span>Arrosage</span>
                  <strong>
                    {prediction.wateringUrgencyHours < 1
                      ? "Maintenant"
                      : prediction.wateringUrgencyHours < 24
                      ? `${Math.round(prediction.wateringUrgencyHours)}h`
                      : `${Math.round(prediction.wateringUrgencyHours / 24)}j`}
                  </strong>
                </div>
              </div>
            ) : (
              <div className="mlUrgencyBadge" data-urgent="false">
                <CheckCircle2 size={14} />
                <div>
                  <span>Arrosage</span>
                  <strong>OK</strong>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="mlScoreSection mlEmpty">
          <div className="mlHealthRing">
            <svg viewBox="0 0 100 100" width={100} height={100} aria-hidden="true">
              <circle cx="50" cy="50" r={44} fill="none" stroke="rgba(74,222,128,0.08)" strokeWidth="8" />
            </svg>
            <span className="mlStressLabel muted">—</span>
          </div>
          <p className="muted small">{loading ? "Analyse..." : "Sélectionne une plante"}</p>
        </div>
      )}

      {/* Breakdown */}
      {prediction && (
        <div className="mlBreakdown">
          <Bar value={prediction.breakdown.sensorScore} color="var(--water)" label="Capteurs" />
          <Bar value={prediction.breakdown.visualScore} color="var(--leaf)" label="Photos" />
          <Bar value={100 - prediction.breakdown.weatherRisk} color="var(--sky)" label="Météo" />
          <Bar value={prediction.breakdown.llmConsensus} color="var(--moss)" label="IA Insights" />
        </div>
      )}

      {/* Dominant signals */}
      {prediction && prediction.dominantSignals.length > 0 && (
        <div className="mlSignals">
          {prediction.dominantSignals.map((signal) => (
            <span className="mlSignalTag" key={signal}>{signal}</span>
          ))}
        </div>
      )}

      {/* Model weights */}
      {weights && (
        <div className="mlWeights">
          <p className="mlSectionLabel">
            <Layers size={13} />
            Poids du modèle
          </p>
          <div className="mlWeightRow">
            <WeightPill label="Capteurs" value={weights.sensor} color="var(--water)" />
            <WeightPill label="Photos" value={weights.visual} color="var(--leaf)" />
            <WeightPill label="Météo" value={weights.weather} color="var(--sky)" />
            <WeightPill label="IA" value={weights.llm} color="var(--moss)" />
          </div>
        </div>
      )}

      {/* Raw features (collapsible) */}
      {features && (
        <div className="mlCollapsible">
          <button
            className="mlCollapsibleToggle"
            onClick={() => setShowFeatures(!showFeatures)}
            aria-expanded={showFeatures}
          >
            <Activity size={13} />
            <span>Signaux bruts</span>
            {showFeatures ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
          {showFeatures && (
            <div className="mlFeaturesGrid">
              <div className="mlFeatureItem">
                <span>Humidité actuelle</span>
                <strong>{features.moisturePct.toFixed(1)}%</strong>
              </div>
              <div className="mlFeatureItem">
                <span>Cible</span>
                <strong>{features.targetMoisturePct.toFixed(1)}%</strong>
              </div>
              <div className="mlFeatureItem">
                <span>Tendance</span>
                <strong style={{ color: features.moistureSlopePctPerHour < -0.5 ? "var(--danger)" : "var(--ink)" }}>
                  {features.moistureSlopePctPerHour > 0 ? "+" : ""}
                  {features.moistureSlopePctPerHour.toFixed(2)}%/h
                </strong>
              </div>
              <div className="mlFeatureItem">
                <span>Fraîcheur capteur</span>
                <strong>{Math.round(features.sensorFreshness * 100)}%</strong>
              </div>
              <div className="mlFeatureItem">
                <span>Santé photo</span>
                <strong>{Math.round(features.photoHealth * 100)}/100</strong>
              </div>
              <div className="mlFeatureItem">
                <span>Confiance photo</span>
                <strong>{Math.round(features.photoConfidence * 100)}%</strong>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Training controls */}
      <div className="mlTrainSection">
        <p className="mlSectionLabel">
          <FlaskConical size={13} />
          Entraînement
          {trainState && (
            <span className="mlSampleCount">{trainState.sampleCount} échantillon{trainState.sampleCount !== 1 ? "s" : ""}</span>
          )}
        </p>
        <div className="mlTrainButtons">
          <button className="secondaryButton" onClick={collect} disabled={!plantId || busy}>
            <Database size={15} />
            Collecter
          </button>
          <button
            className="primaryButton"
            onClick={train}
            disabled={busy || (trainState !== null && trainState.sampleCount < 3)}
            title={trainState && trainState.sampleCount < 3 ? "Minimum 3 échantillons requis" : ""}
          >
            <TrendingUp size={15} />
            Entraîner
          </button>
        </div>
        {status && (
          <p className="mlStatus" data-error={status.startsWith("Erreur") || status.startsWith("Données insuffisantes")}>
            {status}
          </p>
        )}
      </div>

      {/* Training history (collapsible) */}
      {trainState && trainState.versions.length > 0 && (
        <div className="mlCollapsible">
          <button
            className="mlCollapsibleToggle"
            onClick={() => setShowHistory(!showHistory)}
            aria-expanded={showHistory}
          >
            <Clock size={13} />
            <span>Historique ({trainState.versions.length})</span>
            {showHistory ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
          {showHistory && (
            <div className="mlHistoryList">
              {trainState.versions.map((v) => (
                <div className={`mlHistoryItem ${v.isActive ? "active" : ""}`} key={v.version}>
                  <div className="mlHistoryTop">
                    <span className="mlVersionTag">
                      {v.isActive && <Sparkles size={11} />}
                      {v.version}
                    </span>
                    <span className="mlHistoryDate">
                      {v.trainedAt ? new Date(v.trainedAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}
                    </span>
                  </div>
                  <div className="mlHistoryMeta">
                    <span>{v.sampleCount} éch.</span>
                    {v.metrics && (
                      <>
                        <span>RMSE {v.metrics.rmse.toFixed(2)}</span>
                        <span>MAE {v.metrics.mae.toFixed(2)}</span>
                      </>
                    )}
                  </div>
                  <div className="mlWeightRow mlWeightRowSmall">
                    <WeightPill label="S" value={v.weights.sensor} color="var(--water)" />
                    <WeightPill label="V" value={v.weights.visual} color="var(--leaf)" />
                    <WeightPill label="M" value={v.weights.weather} color="var(--sky)" />
                    <WeightPill label="IA" value={v.weights.llm} color="var(--moss)" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
