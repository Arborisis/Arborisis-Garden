import { sendPushToAll } from "@/lib/push";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";

const schema = z.object({
  secret: z.string(),
  title: z.string().optional(),
  body: z.string().optional(),
  urgency: z.enum(["low", "normal", "high", "very-low"]).optional(),
  tag: z.string().optional(),
  plantId: z.string().optional()
});

// Proactive AI check: analyse les alertes ouvertes et envoie une notif si nécessaire
export async function POST(request: Request) {
  const start = Date.now();
  const body = schema.parse(await request.json());

  if (body.secret !== process.env.PUSH_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Si un message explicite est fourni, l'envoyer directement
  if (body.title && body.body) {
    const result = await sendPushToAll({
      title: body.title,
      body: body.body,
      urgency: body.urgency ?? "normal",
      tag: body.tag,
      data: body.plantId ? { plantId: body.plantId } : {}
    });
    console.log(JSON.stringify({ route: "POST /api/push/notify", plantId: body.plantId, sent: (result as { sent?: number }).sent, latencyMs: Date.now() - start, status: 200 }));
    return Response.json(result);
  }

  // Sinon, vérifier l'état des plantes et générer des alertes proactives
  const urgentAlerts = await prisma.alert.findMany({
    where: { status: "open", severity: "critical" },
    include: { plant: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 3
  });

  if (urgentAlerts.length > 0) {
    const alert = urgentAlerts[0];
    const result = await sendPushToAll({
      title: `${alert.plant.name} — ${alert.title}`,
      body: alert.body,
      urgency: "high",
      tag: `alert-${alert.id}`,
      data: { plantId: alert.plantId, alertId: alert.id }
    });
    return Response.json({ triggered: "critical_alert", ...result });
  }

  // Vérifier les plantes avec sol très sec
  const dryReadings = await prisma.reading.findMany({
    where: {
      recordedAt: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) },
      plant: { isNot: null }
    },
    include: { plant: true },
    orderBy: { recordedAt: "desc" },
    take: 20
  });

  for (const r of dryReadings) {
    if (!r.plant || typeof r.soilMoisturePct !== "number") continue;
    const gap = r.soilMoisturePct - r.plant.targetMoisture;
    if (gap < -15) {
      const result = await sendPushToAll({
        title: `${r.plant.name} a soif`,
        body: `Sol à ${Math.round(r.soilMoisturePct)}% — ${Math.abs(Math.round(gap))}% sous la cible. Arrosage recommandé.`,
        urgency: "high",
        tag: `dry-${r.plant.id}`,
        data: { plantId: r.plant.id }
      });
      return Response.json({ triggered: "dry_soil", ...result });
    }
  }

  return Response.json({ triggered: null, message: "Tout va bien, aucune alerte proactive." });
}
