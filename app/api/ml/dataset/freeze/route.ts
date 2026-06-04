import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { datasetIdSchema } from "@/lib/schemas"
import { isMutationAuthorized } from "@/lib/ml/dataset/auth"
import { loadDatasetRows } from "@/lib/ml/dataset/builder"
import { freezeSnapshot } from "@/lib/ml/dataset/snapshot"

export const runtime = "nodejs"

/** POST ?id= — fige un dataset draft: snapshot S3 + checksum, statut "frozen". */
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
  if (dataset.status !== "draft") {
    return NextResponse.json({ error: `Dataset déjà ${dataset.status}` }, { status: 409 })
  }
  if (dataset.sampleCount < 1) {
    return NextResponse.json({ error: "Dataset vide — rien à figer" }, { status: 422 })
  }

  const rows = await loadDatasetRows(dataset.id)
  let snapshot
  try {
    snapshot = await freezeSnapshot(dataset.slug, rows)
  } catch (e) {
    return NextResponse.json({ error: `Échec snapshot S3: ${e instanceof Error ? e.message : "inconnu"}` }, { status: 502 })
  }

  const updated = await prisma.mLDataset.update({
    where: { id: dataset.id },
    data: {
      status: "frozen",
      snapshotObjectKey: snapshot.objectKey,
      checksum: snapshot.checksum,
      frozenAt: new Date()
    }
  })

  console.log(JSON.stringify({ route: "POST /api/ml/dataset/freeze", slug: dataset.slug, checksum: snapshot.checksum, latencyMs: Date.now() - start, status: 200 }))
  return NextResponse.json({
    id: updated.id,
    slug: updated.slug,
    status: updated.status,
    sampleCount: updated.sampleCount,
    snapshotObjectKey: updated.snapshotObjectKey,
    checksum: updated.checksum,
    frozenAt: updated.frozenAt
  })
}
