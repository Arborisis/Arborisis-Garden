import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { datasetListQuerySchema, datasetBuildSchema } from "@/lib/schemas"
import { isMutationAuthorized } from "@/lib/ml/dataset/auth"
import { buildDraft, type DatasetFilter } from "@/lib/ml/dataset/builder"

export const runtime = "nodejs"

function safeParseJson(value: string | null): unknown {
  if (!value) return null
  try { return JSON.parse(value) } catch { return null }
}

/** GET — liste publique des datasets (lecture seule). */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const parsed = datasetListQuerySchema.safeParse(Object.fromEntries(searchParams))
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides" }, { status: 400 })
  const { status, limit = 50 } = parsed.data

  const datasets = await prisma.mLDataset.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: "desc" },
    take: limit
  })

  return NextResponse.json({
    datasets: datasets.map(d => ({
      id: d.id,
      name: d.name,
      slug: d.slug,
      description: d.description,
      status: d.status,
      sampleCount: d.sampleCount,
      featureSchemaVersion: d.featureSchemaVersion,
      labelDistribution: safeParseJson(d.labelDistribution),
      plantIds: safeParseJson(d.plantIds) ?? [],
      license: d.license,
      dateRangeStart: d.dateRangeStart,
      dateRangeEnd: d.dateRangeEnd,
      snapshotObjectKey: d.snapshotObjectKey,
      checksum: d.checksum,
      createdAt: d.createdAt,
      frozenAt: d.frozenAt,
      publishedAt: d.publishedAt
    }))
  })
}

/** POST — build/refresh un dataset draft depuis MLTrainingSample (token-gated). */
export async function POST(req: Request) {
  const start = Date.now()
  if (!isMutationAuthorized(req)) {
    return NextResponse.json({ error: "Token device invalide" }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))
  const parsed = datasetBuildSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides", issues: parsed.error.issues }, { status: 400 })

  const { datasetId, name, slug, description, license, plantId, from, to, labelSource } = parsed.data
  const filter: DatasetFilter = { plantId, from, to, labelSource }

  // Réutiliser un draft existant (par id ou slug) ou en créer un.
  let id = datasetId
  if (!id) {
    const existing = await prisma.mLDataset.findUnique({ where: { slug } })
    if (existing) {
      if (existing.status !== "draft") {
        return NextResponse.json({ error: "Un dataset figé/publié existe déjà avec ce slug" }, { status: 409 })
      }
      id = existing.id
      await prisma.mLDataset.update({ where: { id }, data: { name, description: description ?? existing.description, license: license ?? existing.license } })
    } else {
      const created = await prisma.mLDataset.create({
        data: { name, slug, description: description ?? "", ...(license ? { license } : {}) }
      })
      id = created.id
    }
  }

  let dataset
  try {
    dataset = await buildDraft(id, filter)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Échec du build" }, { status: 422 })
  }

  console.log(JSON.stringify({ route: "POST /api/ml/dataset", slug, sampleCount: dataset?.sampleCount, latencyMs: Date.now() - start, status: 200 }))
  return NextResponse.json({
    id: dataset?.id,
    slug: dataset?.slug,
    status: dataset?.status,
    sampleCount: dataset?.sampleCount,
    labelDistribution: safeParseJson(dataset?.labelDistribution ?? null)
  })
}
