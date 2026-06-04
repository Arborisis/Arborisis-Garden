import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bioelectricSchema } from "@/lib/schemas";
import {
  resolveBioPlant,
  recentBaselineRms,
  computeActivityIndex,
  detectResponses,
} from "@/lib/bioelectric/analysis";

export const runtime = "nodejs";

function isAuthorized(request: NextRequest) {
  const expected = process.env.DEVICE_INGEST_TOKEN;
  if (!expected) return true;
  const header = request.headers.get("x-device-token") ?? "";
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return header === expected || bearer === expected;
}

export async function POST(request: NextRequest) {
  const start = Date.now();
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized device token" }, { status: 401 });
  }

  const json = await request.json();
  const payload = bioelectricSchema.parse(json);

  const device = await prisma.device.upsert({
    where: { serial: payload.deviceSerial },
    update: {
      name: payload.deviceName ?? payload.deviceSerial,
      kind: "bioelectric",
      lastSeen: new Date(),
    },
    create: {
      serial: payload.deviceSerial,
      name: payload.deviceName ?? "Arborisis Bio",
      kind: "bioelectric",
      lastSeen: new Date(),
    },
  });

  const plant = await resolveBioPlant(prisma, device);

  const rms = payload.rmsRaw ?? payload.rmsUv ?? null;
  const baselineRms = await recentBaselineRms(prisma, plant.id);
  const activityIndex = computeActivityIndex(rms, baselineRms);

  const reading = await prisma.bioReading.create({
    data: {
      deviceId: device.id,
      plantId: plant.id,
      recordedAt: payload.recordedAt ? new Date(payload.recordedAt) : new Date(),
      firmwareVersion: payload.firmwareVersion,
      sampleRateHz: payload.sampleRateHz,
      windowSeconds: payload.windowSeconds,
      sampleCount: payload.sampleCount,
      channel: payload.channel,
      gain: payload.gain,
      baselineRaw: payload.baselineRaw,
      baselineUv: payload.baselineUv,
      meanUv: payload.meanUv,
      rmsUv: payload.rmsUv,
      rmsRaw: payload.rmsRaw,
      stdRaw: payload.stdRaw,
      p2pRaw: payload.p2pRaw,
      minRaw: payload.minRaw,
      maxRaw: payload.maxRaw,
      slopeRawPerSec: payload.slopeRawPerSec,
      spikeCount: payload.spikeCount,
      zeroCrossRate: payload.zeroCrossRate,
      bandLowEnergy: payload.bandLowEnergy,
      bandMidEnergy: payload.bandMidEnergy,
      bandHighEnergy: payload.bandHighEnergy,
      activityIndex,
      qualityFlag: payload.qualityFlag,
      waveform: payload.waveform ? JSON.stringify(payload.waveform) : undefined,
      batteryMv: payload.batteryMv,
      wifiRssi: payload.wifiRssi,
    },
  });

  // Détection incrémentale bornée: ne couvre que les évènements très récents,
  // pour rester rapide à l'ingestion. La passe longue tourne sur /api/agent/tick.
  detectResponses(prisma, plant.id, { sinceHours: 2 }).catch(() => null);

  console.log(
    JSON.stringify({
      route: "POST /api/bioelectric",
      deviceSerial: payload.deviceSerial,
      plantId: plant.id,
      activityIndex,
      quality: payload.qualityFlag ?? null,
      latencyMs: Date.now() - start,
      status: 200,
    })
  );

  return NextResponse.json({ ok: true, device, plant, reading });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  let plantId = searchParams.get("plantId") ?? undefined;

  if (!plantId) {
    const recent = await prisma.bioReading.findFirst({
      orderBy: { recordedAt: "desc" },
      select: { plantId: true },
    });
    plantId = recent?.plantId ?? undefined;
  }
  if (!plantId) {
    return NextResponse.json({ plantId: null, readings: [], responses: [] });
  }

  // Passe d'analyse bornée à la lecture (idempotente) pour rafraîchir l'UI.
  await detectResponses(prisma, plantId, { sinceHours: 72 }).catch(() => null);

  const [readings, responses] = await Promise.all([
    prisma.bioReading.findMany({
      where: { plantId },
      orderBy: { recordedAt: "desc" },
      take: 60,
    }),
    prisma.bioResponseEvent.findMany({
      where: { plantId },
      orderBy: { eventAt: "desc" },
      take: 20,
    }),
  ]);

  return NextResponse.json({ plantId, readings, responses });
}
