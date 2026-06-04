import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { datasetExportQuerySchema } from "@/lib/schemas"
import { loadDatasetRows } from "@/lib/ml/dataset/builder"
import { computeDatasetStats } from "@/lib/ml/dataset/stats"
import { toJsonl, toCsv, gzip } from "@/lib/ml/dataset/export"
import { buildDatasheet } from "@/lib/ml/dataset/datasheet"
import { buildHfExport } from "@/lib/ml/dataset/huggingface"

export const runtime = "nodejs"

/** GET ?id=&format=jsonl|csv|hf|datasheet&gzip= — téléchargement public d'un dataset. */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 })

  const parsed = datasetExportQuerySchema.safeParse(Object.fromEntries(searchParams))
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides" }, { status: 400 })
  const { format, gzip: doGzip } = parsed.data

  const dataset = await prisma.mLDataset.findUnique({ where: { id } })
  if (!dataset) return NextResponse.json({ error: "Dataset introuvable" }, { status: 404 })

  const rows = await loadDatasetRows(dataset.id)
  const stats = computeDatasetStats(rows)
  const meta = {
    name: dataset.name,
    slug: dataset.slug,
    description: dataset.description,
    license: dataset.license,
    featureSchemaVersion: dataset.featureSchemaVersion
  }

  let content: string
  let contentType: string
  let extension: string
  switch (format) {
    case "csv":
      content = toCsv(rows); contentType = "text/csv; charset=utf-8"; extension = "csv"; break
    case "datasheet":
      content = buildDatasheet(meta, stats); contentType = "text/markdown; charset=utf-8"; extension = "md"; break
    case "hf":
      content = JSON.stringify(buildHfExport(meta, rows, stats), null, 2); contentType = "application/json"; extension = "hf.json"; break
    case "jsonl":
    default:
      content = toJsonl(rows); contentType = "application/x-ndjson"; extension = "jsonl"; break
  }

  const filenameBase = `${dataset.slug}.${extension}`

  if (doGzip) {
    const body = gzip(content)
    return new Response(body as BodyInit, {
      headers: {
        "Content-Type": contentType,
        "Content-Encoding": "gzip",
        "Content-Disposition": `attachment; filename="${filenameBase}.gz"`
      }
    })
  }

  return new Response(content, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filenameBase}"`
    }
  })
}
