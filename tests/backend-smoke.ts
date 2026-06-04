import { telemetrySchema } from "../lib/schemas";
import { evaluateReading } from "../lib/rules";
import { parseAiInsightsResponse } from "../lib/insights";
import { analyzeStoredBioReadings } from "../lib/bioelectric/adaptive-model";
import { detectEnvironmentEvents } from "../lib/bioelectric/analysis";
import { computeCoupling } from "../lib/bioelectric/coupling";
import type { BioReading } from "@prisma/client";

const payload = telemetrySchema.parse({
  deviceSerial: "pico-test",
  soilMoistureRaw: 42000,
  soilMoisturePct: 24,
  soilTempC: 18.5,
  airTempC: 21.2,
  airHumidityPct: 54,
  pressureHpa: 1012,
  lightLux: 120
});

const alerts = evaluateReading(
  {
    id: "plant",
    name: "Basilic",
    species: "Ocimum basilicum",
    location: "Cuisine",
    notes: null,
    deviceId: "device",
    moistureDryRaw: 52000,
    moistureWetRaw: 22000,
    targetMoisture: 50,
    minLightLux: 250,
    minSoilTempC: 10,
    maxSoilTempC: 30,
    memorySummary: "",
    conversationSummary: "",
    lastCompactedAt: null,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    id: "reading",
    deviceId: "device",
    plantId: "plant",
    recordedAt: new Date(),
    soilMoistureRaw: payload.soilMoistureRaw ?? null,
    soilMoisturePct: payload.soilMoisturePct ?? null,
    soilTempC: payload.soilTempC ?? null,
    airTempC: payload.airTempC ?? null,
    airHumidityPct: payload.airHumidityPct ?? null,
    pressureHpa: payload.pressureHpa ?? null,
    lightLux: payload.lightLux ?? null,
    batteryMv: null,
    wifiRssi: null,
    firmwareVersion: null
  }
);

if (alerts.length < 2) {
  throw new Error(`Expected moisture and light alerts, got ${alerts.length}`);
}

const openRouterInsights = parseAiInsightsResponse(`\`\`\`json
{
  "insights": [
    {
      "title": "Lumi\\u00e8re critique \\u2014 action imm\\u00e9diate",
      "body": "87 lux mesur\\u00e9s ce matin, soit 3 fois sous le minimum requis (250 lux). Le ciel couvert \\u00e0 Bruxelles aggrave la situation. D\\u00e9placez la plante d\\u00e8s aujourd'hui pr\\u00e8s d'une fen\\u00eatre sud ou ouest, \\u00e0 moins de 50 cm de la vitre. Cible : d\\u00e9passer 250 lux en journ\\u00e9e, id\\u00e9alement 500 lux.",
      "tone": "urgent"
    },
    {
      "title": "Humidit\\u00e9 sol parfaite",
      "body": "47,8 \\u00e0 48,3 % sur toutes les mesures, exactement sur la cible de 48 %. Temp\\u00e9rature sol stable \\u00e0 24 \\u00b0C. Aucun arrosage n\\u00e9cessaire aujourd'hui. Prochain contr\\u00f4le recommand\\u00e9 dans 2 \\u00e0 3 jours.",
      "tone": "good"
    },
    {
      "title": "Fertilisation \\u00e0 initier le 02/06",
      "body": "Aucun apport nutritionnel jamais document\\u00e9. Les jaunissements des feuilles int\\u00e9rieures pointent vers une carence probable. Pr\\u00e9parez un engrais liquide \\u00e9quilibr\\u00e9 (NPK 3-1-2) \\u00e0 demi-dose pour le 02/06. Arrosez le substrat avant application pour \\u00e9viter les br\\u00fblures racinaires.",
      "tone": "watch"
    },
    {
      "title": "Rempotage \\u00e0 \\u00e9valuer le 06/06",
      "body": "Plante dense signal\\u00e9e. V\\u00e9rifiez le 06/06 si les racines sortent par le drainage ou si le substrat s\\u00e8che trop vite (moins de 3 jours pour passer de 48 % \\u00e0 35 %). Si oui, rempotez dans un pot 2 cm plus large avec un substrat frais drainant.",
      "tone": "watch"
    }
  ]
}
\`\`\``);

if (openRouterInsights.length !== 4 || openRouterInsights[0].tone !== "urgent") {
  throw new Error("Expected fenced OpenRouter insights payload to parse");
}

function bioReading(overrides: Partial<BioReading> = {}): BioReading {
  const recordedAt = overrides.recordedAt ?? new Date("2026-06-04T10:00:00.000Z");
  const waveform =
    overrides.waveform ??
    JSON.stringify(Array.from({ length: 32 }, (_, i) => 0.5 + Math.sin((i / 31) * Math.PI * 4) * 0.04));
  return {
    id: overrides.id ?? `bio-${recordedAt.getTime()}`,
    deviceId: overrides.deviceId ?? "bio-device",
    plantId: overrides.plantId ?? "plant",
    recordedAt,
    firmwareVersion: overrides.firmwareVersion ?? "test",
    sampleRateHz: overrides.sampleRateHz ?? 128,
    windowSeconds: overrides.windowSeconds ?? 4,
    sampleCount: overrides.sampleCount ?? 512,
    channel: overrides.channel ?? "A0",
    gain: overrides.gain ?? null,
    baselineRaw: overrides.baselineRaw ?? 32768,
    baselineUv: overrides.baselineUv ?? null,
    meanUv: overrides.meanUv ?? null,
    rmsUv: overrides.rmsUv ?? null,
    rmsRaw: overrides.rmsRaw ?? 100,
    stdRaw: overrides.stdRaw ?? 18,
    p2pRaw: overrides.p2pRaw ?? 80,
    minRaw: overrides.minRaw ?? 32720,
    maxRaw: overrides.maxRaw ?? 32820,
    slopeRawPerSec: overrides.slopeRawPerSec ?? 0.4,
    spikeCount: overrides.spikeCount ?? 1,
    zeroCrossRate: overrides.zeroCrossRate ?? 8,
    bandLowEnergy: overrides.bandLowEnergy ?? 55,
    bandMidEnergy: overrides.bandMidEnergy ?? 35,
    bandHighEnergy: overrides.bandHighEnergy ?? 10,
    activityIndex: overrides.activityIndex ?? null,
    qualityFlag: overrides.qualityFlag ?? "ok",
    waveform,
    batteryMv: overrides.batteryMv ?? null,
    wifiRssi: overrides.wifiRssi ?? null,
  };
}

const baselineBio = Array.from({ length: 12 }, (_, i) =>
  bioReading({
    id: `bio-base-${i}`,
    recordedAt: new Date(Date.UTC(2026, 5, 4, 9, i)),
    rmsRaw: 98 + (i % 3),
    p2pRaw: 78 + (i % 2),
    spikeCount: i % 2,
  })
);
const spikeBio = bioReading({
  id: "bio-spike",
  recordedAt: new Date("2026-06-04T10:30:00.000Z"),
  rmsRaw: 185,
  stdRaw: 52,
  p2pRaw: 260,
  spikeCount: 24,
  bandLowEnergy: 20,
  bandMidEnergy: 25,
  bandHighEnergy: 180,
  waveform: JSON.stringify(Array.from({ length: 32 }, (_, i) => (i % 4 === 0 ? 0.92 : 0.42 + (i % 3) * 0.02))),
});
const bioMl = analyzeStoredBioReadings([...baselineBio, spikeBio], [], 100);
const learnedBaseline = bioMl.get("bio-base-11");
const learnedSpike = bioMl.get("bio-spike");

if (learnedBaseline?.pattern !== "baseline" || (learnedBaseline.signalConfidence ?? 0) < 0.55) {
  throw new Error(`Expected learned bio baseline, got ${JSON.stringify(learnedBaseline)}`);
}
if (learnedSpike?.pattern !== "spike_burst" || learnedSpike.anomalyScore <= 0.5) {
  throw new Error(`Expected bio spike burst anomaly, got ${JSON.stringify(learnedSpike)}`);
}

// ---- Détection multi-stimuli (arrosage + lumière + température) -------------
const envBase = new Date("2026-06-01T08:00:00Z").getTime();
const envMin = (m: number) => new Date(envBase + m * 60000);
const envSeries = Array.from({ length: 49 }, (_, k) => {
  const m = k * 5;
  return {
    recordedAt: envMin(m),
    soilMoisturePct: m < 60 ? 20 : 40, // arrosage à t≈60
    soilTempC: 18,
    airTempC: m < 180 ? 22 : 16, // chute thermique à t≈180
    airHumidityPct: 50,
    lightLux: m < 120 ? 50 : 8000, // lever de lumière à t≈120
    pressureHpa: 1010,
  };
});
const envEvents = detectEnvironmentEvents(envSeries);
const detectedTypes = new Set(envEvents.map((e) => e.type));
if (!detectedTypes.has("watering") || !detectedTypes.has("light") || !detectedTypes.has("temp")) {
  throw new Error(`Expected watering+light+temp stimuli, got ${[...detectedTypes].join(",")}`);
}
const wateringEv = envEvents.find((e) => e.type === "watering");
if (!wateringEv || wateringEv.direction !== "up") {
  throw new Error(`Expected upward watering step, got ${JSON.stringify(wateringEv)}`);
}

// ---- Couplage environnement ↔ activité bioélectrique -----------------------
const bioForCoupling = Array.from({ length: 25 }, (_, k) => {
  const m = k * 10;
  const light = m < 120 ? 50 : 8000;
  return { recordedAt: envMin(m + 15), activityIndex: Math.min(1, Math.log(light + 1) / 10) };
});
const coupling = computeCoupling(bioForCoupling, envSeries);
if (coupling.dominant?.channel !== "lightLux" || coupling.dominant.correlation < 0.5) {
  throw new Error(`Expected light to dominate coupling, got ${JSON.stringify(coupling.dominant)}`);
}

console.log("backend smoke ok");
