import { NextResponse } from "next/server"
import { datasetTrainSchema } from "@/lib/schemas"
import { isMutationAuthorized } from "@/lib/ml/dataset/auth"
import { trainFromDataset } from "@/lib/ml/dataset/train"

export const runtime = "nodejs"

/** POST ?id= — entraîne un modèle depuis un dataset figé (token-gated). */
export async function POST(req: Request) {
  const start = Date.now()
  if (!isMutationAuthorized(req)) {
    return NextResponse.json({ error: "Token device invalide" }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))
  const { searchParams } = new URL(req.url)
  const id = body.id ?? searchParams.get("id")
  if (!id || typeof id !== "string") return NextResponse.json({ error: "id requis" }, { status: 400 })

  const parsed = datasetTrainSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Paramètres invalides" }, { status: 400 })

  const result = await trainFromDataset(id, parsed.data.epochs ?? 300)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  console.log(JSON.stringify({ route: "POST /api/ml/dataset/train", datasetId: id, version: result.version, adopted: result.adopted, rmse: result.rmse, latencyMs: Date.now() - start, status: 200 }))
  return NextResponse.json({
    version: result.version,
    sampleCount: result.sampleCount,
    adopted: result.adopted,
    metrics: {
      rmse: result.rmse,
      mae: result.mae,
      valRmse: result.valRmse,
      residualKind: result.residualKind,
      epochs: result.epochs
    }
  })
}
