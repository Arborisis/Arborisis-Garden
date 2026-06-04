import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { datasetIdSchema } from "@/lib/schemas"
import { isMutationAuthorized } from "@/lib/ml/dataset/auth"
import { loadDatasetRows } from "@/lib/ml/dataset/builder"
import { uploadDatasetArtifact } from "@/lib/ml/dataset/snapshot"
import { computeDatasetStats } from "@/lib/ml/dataset/stats"
import { buildDatasheet } from "@/lib/ml/dataset/datasheet"
import { buildHfExport } from "@/lib/ml/dataset/huggingface"

export const runtime = "nodejs"

/** POST ?id= — publie un dataset figé: datasheet + export HF sur S3 (token-gated). */
export async function POST(req: Request) {
  const start = Date.now()
  if (!isMutationAuthorized(req)) {
    return NextResponse.json({ error: "Token device invalide" }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))
  const { searchParams } = new URL(req.url)
  const parsed = datasetIdSchema.safeParse({ id: body.id ?? searchParams.get("id") })
  if (!parsed.success) return NextResponse.json({ error: "id requis" }, { status: 400 })

  const dataset = await prisma.mLDataset.findUnique({ where: { id: parsed.data.id } })
  if (!dataset) return NextResponse.json({ error: "Dataset introuvable" }, { status: 404 })
  if (dataset.status === "draft") {
    return NextResponse.json({ error: "Figez le dataset avant de le publier" }, { status: 422 })
  }

  const rows = await loadDatasetRows(dataset.id)
  const stats = computeDatasetStats(rows)
  const meta = {
    name: dataset.name,
    slug: dataset.slug,
    description: dataset.description,
    license: dataset.license,
    featureSchemaVersion: dataset.featureSchemaVersion
  }
  const datasheet = buildDatasheet(meta, stats)
  const hf = buildHfExport(meta, rows, stats)

  try {
    await Promise.all([
      uploadDatasetArtifact(dataset.slug, "DATASHEET.md", datasheet, "text/markdown; charset=utf-8"),
      uploadDatasetArtifact(dataset.slug, "README.md", hf["README.md"], "text/markdown; charset=utf-8"),
      uploadDatasetArtifact(dataset.slug, "metadata.json", hf["metadata.json"], "application/json"),
      uploadDatasetArtifact(dataset.slug, "data.jsonl", hf["data.jsonl"], "application/x-ndjson")
    ])
  } catch (e) {
    return NextResponse.json({ error: `Échec upload S3: ${e instanceof Error ? e.message : "inconnu"}` }, { status: 502 })
  }

  const updated = await prisma.mLDataset.update({
    where: { id: dataset.id },
    data: { status: "published", publishedAt: new Date() }
  })

  console.log(JSON.stringify({ route: "POST /api/ml/dataset/publish", slug: dataset.slug, latencyMs: Date.now() - start, status: 200 }))
  return NextResponse.json({
    id: updated.id,
    slug: updated.slug,
    status: updated.status,
    publishedAt: updated.publishedAt,
    artifacts: ["DATASHEET.md", "README.md", "metadata.json", "data.jsonl"]
  })
}
