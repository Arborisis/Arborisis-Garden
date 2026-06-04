"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, BrainCircuit, CheckCircle2, RefreshCw, Zap } from "lucide-react";

const ACCENT = "var(--bloom, #b06ab3)";

const bioStatStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  flex: "1 1 80px",
  minWidth: 80,
} as const;

type BioReadingRow = {
  id: string;
  recordedAt: string;
  activityIndex: number | null;
  qualityFlag: string | null;
  rmsRaw: number | null;
  rmsUv: number | null;
  spikeCount: number | null;
  gain: number | null;
  sampleRateHz: number;
  windowSeconds: number;
  waveform: string | null;
  firmwareVersion: string | null;
  wifiRssi: number | null;
  signalMl?: {
    signalConfidence: number;
    pattern: string;
    anomalyScore?: number;
    stressScore?: number;
    rhythmScore?: number;
    stabilityScore?: number;
    spectralBalance?: {
      low: number;
      mid: number;
      high: number;
      entropy: number;
    };
    reasons?: string[];
    learnedFromWindows: number;
  } | null;
};

type BioResponseRow = {
  id: string;
  eventType: string;
  eventAt: string;
  responseRatio: number;
  latencyMin: number | null;
  reacted: boolean;
  confidence: number;
};

type CouplingChannel = {
  channel: string;
  label: string;
  correlation: number;
  lagMin: number;
  confidence: number;
};

type CouplingPayload = {
  dominant: CouplingChannel | null;
  channels: CouplingChannel[];
  text: string;
} | null;

const STIMULUS_LABELS: Record<string, string> = {
  watering: "arrosage",
  light: "lumière",
  temp: "température",
  humidity: "humidité de l'air",
  pressure: "pression",
  unknown: "stimulus",
};

function stimulusLabel(eventType: string): string {
  return STIMULUS_LABELS[eventType] ?? eventType;
}

function parseWaveform(value: string | null | undefined): number[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "number") : [];
  } catch {
    return [];
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso.slice(0, 16).replace("T", " ");
  }
}

function formatPattern(pattern: string | null | undefined): string {
  switch (pattern) {
    case "baseline": return "baseline apprise";
    case "recoverable_noise": return "bruit récupérable";
    case "spike_burst": return "salve de pics";
    case "slow_drift": return "dérive lente";
    case "electrode_shift": return "déplacement électrode";
    case "rhythmic_pulse": return "pulsation rythmique";
    case "stress_response": return "réponse de stress";
    case "flatline": return "signal plat";
    case "saturation": return "saturation";
    default: return "motif inconnu";
  }
}

function pct(value: number | null | undefined): string {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "—";
}

function MlMeter({ label, value }: { label: string; value: number | null | undefined }) {
  const clamped = typeof value === "number" ? Math.max(0, Math.min(1, value)) : 0;
  return (
    <div style={{ flex: "1 1 92px", minWidth: 92 }}>
      <div className="muted small" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span>{label}</span>
        <span>{pct(value)}</span>
      </div>
      <div style={{ height: 5, borderRadius: 4, background: "rgba(120,120,120,0.16)", overflow: "hidden", marginTop: 3 }}>
        <div style={{ width: `${clamped * 100}%`, height: "100%", background: ACCENT }} />
      </div>
    </div>
  );
}

/** Petite forme d'onde SVG normalisée (points 0-1 ou bruts auto-échelonnés). */
function Sparkline({ points, height = 44 }: { points: number[]; height?: number }) {
  if (points.length < 2) {
    return <p className="muted small">Pas de forme d&apos;onde.</p>;
  }
  const width = 100;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const path = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * width;
      const y = height - ((v - min) / span) * (height - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden="true">
      <path d={path} fill="none" stroke={ACCENT} strokeWidth="1.4" />
    </svg>
  );
}

/** Mini barres d'activité dans le temps (0-1). */
function ActivityBars({ values }: { values: number[] }) {
  if (values.length === 0) return null;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 40 }}>
      {values.map((v, i) => (
        <div
          key={i}
          title={`${Math.round(v * 100)}%`}
          style={{
            flex: 1,
            minWidth: 2,
            height: `${Math.max(4, Math.min(100, v * 100))}%`,
            background: ACCENT,
            opacity: 0.35 + 0.65 * Math.min(1, v),
            borderRadius: 2,
          }}
        />
      ))}
    </div>
  );
}

export function BioelectricPanel({ plantId, className }: { plantId: string; className?: string }) {
  const [readings, setReadings] = useState<BioReadingRow[]>([]);
  const [responses, setResponses] = useState<BioResponseRow[]>([]);
  const [coupling, setCoupling] = useState<CouplingPayload>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!plantId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/bioelectric?plantId=${encodeURIComponent(plantId)}`);
      const data = await res.json();
      setReadings(Array.isArray(data.readings) ? data.readings : []);
      setResponses(Array.isArray(data.responses) ? data.responses : []);
      setCoupling(data.coupling ?? null);
    } catch {
      /* réseau indisponible: on garde l'état précédent */
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [plantId]);

  useEffect(() => {
    load();
  }, [load]);

  const latest = readings[0];
  const activityPct = latest?.activityIndex != null ? Math.round(latest.activityIndex * 100) : null;
  const signalConfidencePct =
    latest?.signalMl?.signalConfidence != null ? Math.round(latest.signalMl.signalConfidence * 100) : null;
  const okCount = readings.filter((r) => r.qualityFlag === "ok").length;
  const qualityPct = readings.length ? Math.round((okCount / readings.length) * 100) : null;
  const reactedCount = responses.filter((r) => r.reacted).length;
  const waveform = parseWaveform(latest?.waveform);
  const series = [...readings].slice(0, 40).reverse().map((r) => r.activityIndex ?? 0);
  const hasData = readings.length > 0;
  const contactWarning =
    latest?.qualityFlag === "floating"
      ? "Électrode flottante : vérifie le contact (signal A0/GP26 + GND, pas VCC)."
      : latest?.qualityFlag === "flatline"
      ? "Signal plat : électrode mal en contact ou plante peu réactive."
      : null;

  return (
    <section className={`panel bioPanel ${className ?? ""}`}>
      <div className="panelHeader">
        <h2>Bioélectricité</h2>
        <button
          type="button"
          className="iconButton"
          onClick={load}
          disabled={loading}
          aria-label="Rafraîchir"
          title="Rafraîchir"
        >
          <RefreshCw size={16} className={loading ? "spinning" : undefined} />
        </button>
      </div>

      {!hasData ? (
        <p className="muted small">
          {loaded
            ? "Aucune mesure bioélectrique. Branche le 2e Pico (firmware bio) sur la plante."
            : "Chargement..."}
        </p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <div style={bioStatStyle}>
              <span className="muted small">Activité</span>
              <strong style={{ fontSize: 26, color: ACCENT }}>
                {activityPct != null ? `${activityPct}%` : "—"}
              </strong>
            </div>
            <div style={bioStatStyle}>
              <span className="muted small">Qualité signal</span>
              <strong style={{ fontSize: 26 }}>{qualityPct != null ? `${qualityPct}%` : "—"}</strong>
            </div>
            <div style={bioStatStyle}>
              <span className="muted small">Réactions</span>
              <strong style={{ fontSize: 26 }}>{reactedCount}</strong>
            </div>
            <div style={bioStatStyle}>
              <span className="muted small">ML signal</span>
              <strong style={{ fontSize: 26 }}>{signalConfidencePct != null ? `${signalConfidencePct}%` : "—"}</strong>
            </div>
          </div>

          {contactWarning && (
            <p
              className="small"
              style={{
                margin: "0 0 10px",
                padding: "8px 10px",
                borderRadius: 8,
                background: "rgba(220,160,40,0.12)",
                color: "#9a6a00",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <AlertTriangle size={14} /> {contactWarning}
            </p>
          )}

          <div style={{ marginBottom: 10 }}>
            <span className="muted small" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Zap size={13} /> Dernière fenêtre · {latest ? formatDate(latest.recordedAt) : "—"}
              {latest?.qualityFlag ? ` · ${latest.qualityFlag}` : ""}
            </span>
            {latest?.signalMl && (
              <>
                <span className="muted small" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                  <BrainCircuit size={13} /> {formatPattern(latest.signalMl.pattern)}
                  {latest.signalMl.learnedFromWindows ? ` · appris sur ${latest.signalMl.learnedFromWindows} fenêtres` : ""}
                </span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  <MlMeter label="Stabilité" value={latest.signalMl.stabilityScore} />
                  <MlMeter label="Stress" value={latest.signalMl.stressScore} />
                  <MlMeter label="Anomalie" value={latest.signalMl.anomalyScore} />
                  <MlMeter label="Rythme" value={latest.signalMl.rhythmScore} />
                </div>
                {latest.signalMl.reasons?.length ? (
                  <div className="muted small" style={{ marginTop: 6 }}>
                    {latest.signalMl.reasons.slice(0, 3).join(" · ")}
                  </div>
                ) : null}
              </>
            )}
            <Sparkline points={waveform} />
          </div>

          <div style={{ marginBottom: 12 }}>
            <span className="muted small" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Activity size={13} /> Activité récente
            </span>
            <ActivityBars values={series} />
          </div>

          {coupling?.channels?.length ? (
            <div style={{ marginBottom: 12 }}>
              <span className="muted small" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Activity size={13} /> Couplage environnement → signal
              </span>
              {coupling.dominant ? (
                <p className="small" style={{ margin: "4px 0 6px" }}>
                  Surtout corrélé à <strong>{coupling.dominant.label}</strong> (r=
                  {coupling.dominant.correlation.toFixed(2)}
                  {coupling.dominant.lagMin > 0 ? `, retard ~${coupling.dominant.lagMin} min` : ""})
                </p>
              ) : (
                <p className="muted small" style={{ margin: "4px 0 6px" }}>
                  Aucun couplage dominant fiable pour l&apos;instant.
                </p>
              )}
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 4 }}>
                {coupling.channels.slice(0, 4).map((c) => (
                  <li key={c.channel} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="muted small" style={{ width: 130, flexShrink: 0 }}>
                      {c.label}
                    </span>
                    <div
                      style={{
                        flex: 1,
                        height: 6,
                        borderRadius: 3,
                        background: "rgba(120,120,120,0.12)",
                        position: "relative",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: `${Math.min(100, Math.abs(c.correlation) * 100)}%`,
                          background: c.correlation >= 0 ? ACCENT : "#c2603a",
                          borderRadius: 3,
                        }}
                      />
                    </div>
                    <span className="muted small" style={{ width: 64, textAlign: "right", flexShrink: 0 }}>
                      r={c.correlation.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <span className="muted small">Réactions détectées</span>
            {responses.length === 0 ? (
              <p className="muted small">Aucune réaction à un stimulus corrélée pour l&apos;instant.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0", display: "grid", gap: 6 }}>
                {responses.slice(0, 6).map((r) => {
                  const pct = Math.round((r.responseRatio - 1) * 100);
                  const sign = pct >= 0 ? `+${pct}` : `${pct}`;
                  const label = stimulusLabel(r.eventType);
                  return (
                    <li
                      key={r.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 10px",
                        borderRadius: 8,
                        background: r.reacted ? "rgba(176,106,179,0.10)" : "rgba(120,120,120,0.06)",
                      }}
                    >
                      {r.reacted ? (
                        <CheckCircle2 size={16} color={ACCENT} />
                      ) : (
                        <AlertTriangle size={16} className="muted" />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <strong style={{ fontSize: 13 }}>
                          {r.reacted
                            ? `Réaction (${label}, ${sign}%)`
                            : `${label.charAt(0).toUpperCase()}${label.slice(1)} sans réaction nette`}
                        </strong>
                        <div className="muted small">
                          {formatDate(r.eventAt)}
                          {r.reacted && r.latencyMin != null ? ` · latence ${Math.round(r.latencyMin)} min` : ""}
                          {` · confiance ${r.confidence.toFixed(2)}`}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
