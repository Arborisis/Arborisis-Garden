"use client";

import { useCallback, useEffect, useState } from "react";
import { Database, Download, FlaskConical, Layers, Lock, RefreshCw, Snowflake, UploadCloud } from "lucide-react";

type LabelDistribution = {
  sampleCount: number;
  labelMin: number;
  labelMax: number;
  labelMean: number;
  labelStd: number;
  histogram: number[];
  perLabelSource: Record<string, number>;
} | null;

type Dataset = {
  id: string;
  name: string;
  slug: string;
  description: string;
  status: "draft" | "frozen" | "published";
  sampleCount: number;
  featureSchemaVersion: number;
  labelDistribution: LabelDistribution;
  plantIds: string[];
  license: string;
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
  checksum: string | null;
  createdAt: string;
  frozenAt: string | null;
  publishedAt: string | null;
};

const STATUS_LABEL: Record<Dataset["status"], string> = {
  draft: "Brouillon",
  frozen: "Figé",
  published: "Publié"
};

const STATUS_COLOR: Record<Dataset["status"], string> = {
  draft: "var(--sun)",
  frozen: "var(--moss)",
  published: "var(--leaf)"
};

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "dataset";
}

export function MLDatasetPanel({ plantId }: { plantId?: string }) {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [name, setName] = useState("");
  const [scopeToPlant, setScopeToPlant] = useState(false);

  const fetchDatasets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ml/dataset");
      if (!res.ok) throw new Error(`${res.status}`);
      const data = (await res.json()) as { datasets: Dataset[] };
      setDatasets(data.datasets);
    } catch {
      setStatus("Erreur de chargement des datasets");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDatasets();
  }, [fetchDatasets]);

  const post = useCallback(async (url: string, body?: unknown) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {})
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
    return data;
  }, []);

  const buildDataset = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setStatus("Donnez un nom au dataset"); return; }
    setBusy(true);
    setStatus("Construction du dataset...");
    try {
      await post("/api/ml/dataset", {
        name: trimmed,
        slug: slugify(trimmed),
        ...(scopeToPlant && plantId ? { plantId } : {})
      });
      setName("");
      setStatus("Dataset brouillon créé");
      await fetchDatasets();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Échec du build");
    } finally {
      setBusy(false);
    }
  };

  const runAction = async (label: string, url: string) => {
    setBusy(true);
    setStatus(`${label}...`);
    try {
      await post(url);
      setStatus(`${label} — OK`);
      await fetchDatasets();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : `Échec: ${label}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card mlCard">
      <header className="mlHeader">
        <div className="mlHeaderTitle">
          <Database size={18} />
          <h2>Datasets ML</h2>
        </div>
        <button className="iconButton" onClick={() => void fetchDatasets()} disabled={loading} aria-label="Rafraîchir">
          <RefreshCw size={16} className={loading ? "spin" : ""} />
        </button>
      </header>

      <p className="muted" style={{ fontSize: "0.8rem" }}>
        Construisez un jeu de données versionné depuis les échantillons collectés, figez-le
        (snapshot immuable), entraînez un modèle et publiez (JSONL/CSV, export Hugging Face, datasheet).
      </p>

      <div className="mlDatasetBuilder" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "0.5rem 0" }}>
        <input
          placeholder="Nom du dataset (ex: Santé jardin été)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          style={{ flex: 1, minWidth: 180 }}
        />
        {plantId && (
          <label className="muted" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.8rem" }}>
            <input type="checkbox" checked={scopeToPlant} onChange={(e) => setScopeToPlant(e.target.checked)} />
            Cette plante seule
          </label>
        )}
        <button className="primaryButton" onClick={buildDataset} disabled={busy}>
          <Layers size={15} /> Construire
        </button>
      </div>

      {status && <p className="mlStatus" style={{ fontSize: "0.8rem" }}>{status}</p>}

      <ul className="mlDatasetList" style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {datasets.length === 0 && !loading && <li className="muted">Aucun dataset pour l'instant.</li>}
        {datasets.map((d) => {
          const dist = d.labelDistribution;
          const maxBin = dist ? Math.max(1, ...dist.histogram) : 1;
          return (
            <li key={d.id} className="mlDatasetItem" style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <div>
                  <strong>{d.name}</strong>
                  <span className="muted" style={{ marginLeft: 8, fontSize: "0.75rem" }}>{d.slug}</span>
                </div>
                <span style={{ color: STATUS_COLOR[d.status], fontWeight: 600, fontSize: "0.8rem", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  {d.status === "frozen" || d.status === "published" ? <Lock size={12} /> : null}
                  {STATUS_LABEL[d.status]}
                </span>
              </div>

              <div className="muted" style={{ fontSize: "0.78rem", marginTop: 4 }}>
                {d.sampleCount} échantillon(s) · {d.plantIds.length} plante(s) · schéma v{d.featureSchemaVersion}
                {dist ? ` · santé moy. ${dist.labelMean.toFixed(0)}` : ""}
              </div>

              {dist && dist.sampleCount > 0 && (
                <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 28, marginTop: 6 }} aria-hidden="true">
                  {dist.histogram.map((v, i) => (
                    <div key={i} title={`${i * 10}–${i * 10 + 10}: ${v}`} style={{ flex: 1, height: `${(v / maxBin) * 100}%`, background: "var(--leaf)", opacity: 0.35 + 0.65 * (v / maxBin), borderRadius: 2 }} />
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                {d.status === "draft" && (
                  <button className="secondaryButton" disabled={busy || d.sampleCount < 1} onClick={() => void runAction("Gel", `/api/ml/dataset/freeze?id=${d.id}`)}>
                    <Snowflake size={14} /> Figer
                  </button>
                )}
                {(d.status === "frozen" || d.status === "published") && (
                  <button className="secondaryButton" disabled={busy || d.sampleCount < 3} onClick={() => void runAction("Entraînement", `/api/ml/dataset/train?id=${d.id}`)}>
                    <FlaskConical size={14} /> Entraîner
                  </button>
                )}
                {d.status === "frozen" && (
                  <button className="secondaryButton" disabled={busy} onClick={() => void runAction("Publication", `/api/ml/dataset/publish?id=${d.id}`)}>
                    <UploadCloud size={14} /> Publier
                  </button>
                )}
                {(["jsonl", "csv", "hf", "datasheet"] as const).map((fmt) => (
                  <a
                    key={fmt}
                    className="secondaryButton"
                    href={`/api/ml/dataset/export?id=${d.id}&format=${fmt}${fmt === "jsonl" || fmt === "csv" ? "&gzip=1" : ""}`}
                    style={{ textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
                  >
                    <Download size={13} /> {fmt}
                  </a>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
