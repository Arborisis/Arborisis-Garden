import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { evaluateReading } from "@/lib/rules";
import { detectResponses } from "@/lib/bioelectric/analysis";
import { maybeAutoTrain, type AutoTrainOutcome } from "@/lib/ml/dataset/auto-train";

export const runtime = "nodejs";

export async function POST() {
  const plants = await prisma.plant.findMany({
    include: {
      readings: { orderBy: { recordedAt: "desc" }, take: 1 }
    }
  });

  let created = 0;
  let bioResponses = 0;
  for (const plant of plants) {
    // Passe d'analyse bioélectrique long-terme (réactions à l'arrosage sur 7 j).
    bioResponses += await detectResponses(prisma, plant.id, { sinceHours: 168 }).catch(() => 0);

    const latest = plant.readings[0];
    if (!latest) continue;
    const alerts = evaluateReading(plant, latest);
    for (const alert of alerts) {
      const duplicate = await prisma.alert.findFirst({
        where: { plantId: plant.id, title: alert.title, status: "open" }
      });
      if (!duplicate) {
        await prisma.alert.create({ data: { ...alert, plantId: plant.id } });
        created += 1;
      }
    }
  }

  // Auto-entraînement ML au seuil (ML_AUTO_TRAIN_THRESHOLD). Résilient: une erreur
  // (ex: bucket S3 non configuré) ne fait pas échouer le sweep.
  let autoTrain: AutoTrainOutcome = { triggered: false };
  try {
    autoTrain = await maybeAutoTrain(new Date());
  } catch (e) {
    autoTrain = { triggered: false, reason: e instanceof Error ? e.message : "auto-train erreur" };
  }

  return NextResponse.json({ ok: true, alertsCreated: created, bioResponses, autoTrain });
}
