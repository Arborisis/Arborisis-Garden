import { gzipSync, gunzipSync } from "node:zlib"
import { createHash } from "node:crypto"
import { FEATURE_KEYS } from "../featureVector"
import type { DatasetRow } from "./types"

/**
 * Sérialise les lignes en JSONL (une ligne JSON par échantillon). Forme
 * canonique utilisée pour le snapshot figé et le checksum: la propriété features
 * est sérialisée dans l'ordre stable de FEATURE_KEYS pour la reproductibilité.
 */
export function toJsonl(rows: DatasetRow[]): string {
  return rows
    .map(r => JSON.stringify({
      features: r.features,
      label: r.label,
      labelSource: r.labelSource,
      plantId: r.plantId,
      sampledAt: r.sampledAt
    }))
    .join("\n")
}

/** Parse un JSONL (tolère les lignes vides). Round-trip de toJsonl. */
export function fromJsonl(jsonl: string): DatasetRow[] {
  return jsonl
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => JSON.parse(l) as DatasetRow)
}

function csvCell(value: string | number): string {
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Sérialise les lignes en CSV aplati: une colonne par feature (dans l'ordre de
 * FEATURE_KEYS), suivie de label, labelSource, plantId, sampledAt. Le header
 * compte donc FEATURE_KEYS.length + 4 colonnes.
 */
export function toCsv(rows: DatasetRow[]): string {
  const header = [...FEATURE_KEYS, "label", "labelSource", "plantId", "sampledAt"]
  const lines = [header.map(csvCell).join(",")]
  for (const r of rows) {
    const cells: (string | number)[] = FEATURE_KEYS.map(k => {
      const v = r.features[k]
      return typeof v === "number" && Number.isFinite(v) ? v : 0
    })
    cells.push(r.label, r.labelSource, r.plantId, r.sampledAt)
    lines.push(cells.map(csvCell).join(","))
  }
  return lines.join("\n")
}

/** Gzip d'un buffer/chaîne (synchrone — payloads petits à ce volume). */
export function gzip(input: Buffer | string): Buffer {
  return gzipSync(typeof input === "string" ? Buffer.from(input, "utf8") : input)
}

/** Décompresse un gzip (utilisé au re-export depuis le snapshot S3). */
export function gunzip(input: Buffer): Buffer {
  return gunzipSync(input)
}

/** Checksum sha256 hex d'un buffer/chaîne (intégrité du snapshot figé). */
export function sha256(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex")
}
