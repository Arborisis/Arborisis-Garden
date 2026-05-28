import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { evaluateReading } from "@/lib/rules";

export const runtime = "nodejs";

export async function POST() {
  const plants = await prisma.plant.findMany({
    include: {
      readings: { orderBy: { recordedAt: "desc" }, take: 1 }
    }
  });

  let created = 0;
  for (const plant of plants) {
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

  return NextResponse.json({ ok: true, alertsCreated: created });
}
