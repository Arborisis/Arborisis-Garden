"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, RefreshCw, Zap } from "lucide-react";

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
            <Sparkline points={waveform} />
          </div>

          <div style={{ marginBottom: 12 }}>
            <span className="muted small" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Activity size={13} /> Activité récente
            </span>
            <ActivityBars values={series} />
          </div>

          <div>
            <span className="muted small">Réactions détectées</span>
            {responses.length === 0 ? (
              <p className="muted small">Aucune réaction à un arrosage corrélée pour l&apos;instant.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0", display: "grid", gap: 6 }}>
                {responses.slice(0, 6).map((r) => {
                  const pct = Math.round((r.responseRatio - 1) * 100);
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
                          {r.reacted ? `Réaction à l'arrosage (+${pct}%)` : "Arrosage sans réaction nette"}
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
