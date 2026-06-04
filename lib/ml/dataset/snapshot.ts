import { uploadBucketObject } from "@/lib/photo-storage"
import { toJsonl, gzip, sha256 } from "./export"
import type { DatasetRow } from "./types"

/** Préfixe S3 des artefacts de datasets ML. */
export function datasetObjectPrefix(slug: string): string {
  return `ml-datasets/${slug}`
}

export type FrozenSnapshot = {
  objectKey: string
  checksum: string
  byteLength: number
}

/**
 * Fige un dataset: sérialise les lignes en JSONL canonique, calcule le checksum
 * sha256 du JSONL non compressé (intégrité reproductible), gzip, puis pousse
 * l'archive sur le stockage objet S3 (réutilise uploadBucketObject). Retourne la
 * clé objet + le checksum à persister sur MLDataset.
 */
export async function freezeSnapshot(slug: string, rows: DatasetRow[]): Promise<FrozenSnapshot> {
  const jsonl = toJsonl(rows)
  const checksum = sha256(jsonl)
  const compressed = gzip(jsonl)
  const objectKey = `${datasetObjectPrefix(slug)}/snapshot.jsonl.gz`

  await uploadBucketObject({
    objectKey,
    bytes: compressed,
    contentType: "application/gzip"
  })

  return { objectKey, checksum, byteLength: compressed.length }
}

/** Pousse un artefact texte de publication (datasheet, README HF, metadata.json). */
export async function uploadDatasetArtifact(
  slug: string,
  filename: string,
  content: string,
  contentType: string
): Promise<string> {
  const objectKey = `${datasetObjectPrefix(slug)}/${filename}`
  await uploadBucketObject({
    objectKey,
    bytes: Buffer.from(content, "utf8"),
    contentType
  })
  return objectKey
}
