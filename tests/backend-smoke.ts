import { telemetrySchema } from "../lib/schemas";
import { evaluateReading } from "../lib/rules";

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

console.log("backend smoke ok");
