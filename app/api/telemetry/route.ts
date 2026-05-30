import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { telemetrySchema } from "@/lib/schemas";
import { evaluateReading, summarizeReading } from "@/lib/rules";
import { moisturePercentFromRaw } from "@/lib/calibration";
import { sendPushToAll } from "@/lib/push";

export const runtime = "nodejs";

function isAuthorized(request: NextRequest) {
  const expected = process.env.DEVICE_INGEST_TOKEN;
  if (!expected) return true;
  const header = request.headers.get("x-device-token") ?? "";
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return header === expected || bearer === expected;
}

export async function GET() {
  const readings = await prisma.reading.findMany({
    orderBy: { recordedAt: "desc" },
    take: 80,
    include: { device: true, plant: true }
  });

  return NextResponse.json({ readings });
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized device token" }, { status: 401 });
  }

  const json = await request.json();
  const payload = telemetrySchema.parse(json);

  const device = await prisma.device.upsert({
    where: { serial: payload.deviceSerial },
    update: {
      name: payload.deviceName ?? payload.deviceSerial,
      lastSeen: new Date()
    },
    create: {
      serial: payload.deviceSerial,
      name: payload.deviceName ?? "Arborisis Pico",
      lastSeen: new Date()
    }
  });

  let plant = await prisma.plant.findFirst({ where: { deviceId: device.id } });
  if (!plant) {
    plant = await prisma.plant.create({
      data: {
        name: "Ma plante",
        species: "A definir",
        location: "Maison",
        deviceId: device.id
      }
    });
  }

  const calibratedMoisturePct =
    typeof payload.soilMoistureRaw === "number"
      ? moisturePercentFromRaw(payload.soilMoistureRaw, plant.moistureDryRaw, plant.moistureWetRaw)
      : payload.soilMoisturePct;

  const reading = await prisma.reading.create({
    data: {
      deviceId: device.id,
      plantId: plant.id,
      recordedAt: payload.recordedAt ? new Date(payload.recordedAt) : new Date(),
      firmwareVersion: payload.firmwareVersion,
      soilMoistureRaw: payload.soilMoistureRaw,
      soilMoisturePct: calibratedMoisturePct,
      soilTempC: payload.soilTempC,
      airTempC: payload.airTempC,
      airHumidityPct: payload.airHumidityPct,
      pressureHpa: payload.pressureHpa,
      lightLux: payload.lightLux,
      batteryMv: payload.batteryMv,
      wifiRssi: payload.wifiRssi
    }
  });

  const alerts = evaluateReading(plant, reading);
  if (alerts.length) {
    await prisma.alert.createMany({
      data: alerts.map((alert) => ({ ...alert, plantId: plant!.id }))
    });

    const criticalAlerts = alerts.filter((a) => a.severity === "critical" || a.severity === "warning");
    if (criticalAlerts.length) {
      const first = criticalAlerts[0];
      sendPushToAll({ title: first.title, body: first.body, tag: `alert-${plant.id}` }).catch(() => null);
    }
  }

  await prisma.memory.create({
    data: {
      plantId: plant.id,
      kind: "sensor_observation",
      content: summarizeReading(reading)
    }
  });

  return NextResponse.json({ ok: true, device, plant, reading, alerts });
}
