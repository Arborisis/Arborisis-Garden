import type { Plant, Reading } from "@prisma/client";

export type PlantProfileCalibration = {
  targetMoisture: number;
  minLightLux: number;
  minSoilTempC: number;
  maxSoilTempC: number;
  confidence: number;
  researchedName: string;
  reason: string;
  sources: Array<{ title: string; url: string }>;
};

export type SensorCalibration = {
  moistureDryRaw: number;
  moistureWetRaw: number;
  confidence: number;
  appliedFromHistory: boolean;
  reason: string;
};

export type CalibrationRecommendation = {
  profile: PlantProfileCalibration;
  sensor: SensorCalibration;
};

function clampInt(value: number, min: number, max: number) {
  return Math.round(Math.max(min, Math.min(max, value)));
}

function requireNumber(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Calibration LLM invalide: ${label} manquant ou non numerique.`);
  }
  return number;
}

function percentile(values: number[], ratio: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.round((sorted.length - 1) * ratio);
  return sorted[index];
}

export function moisturePercentFromRaw(raw: number, dryRaw: number, wetRaw: number) {
  if (dryRaw === wetRaw) return null;
  const pct = ((dryRaw - raw) * 100) / (dryRaw - wetRaw);
  return Math.max(0, Math.min(100, pct));
}

export function buildSensorCalibration(
  plant: Pick<Plant, "moistureDryRaw" | "moistureWetRaw">,
  readings: Pick<Reading, "soilMoistureRaw" | "soilMoisturePct">[]
): SensorCalibration {
  const rawValues = readings
    .map((reading) => reading.soilMoistureRaw)
    .filter((value): value is number => typeof value === "number");
  const wetCandidates = readings
    .filter((reading) => typeof reading.soilMoistureRaw === "number" && typeof reading.soilMoisturePct === "number" && reading.soilMoisturePct >= 65)
    .map((reading) => reading.soilMoistureRaw as number);
  const dryCandidates = readings
    .filter((reading) => typeof reading.soilMoistureRaw === "number" && typeof reading.soilMoisturePct === "number" && reading.soilMoisturePct <= 25)
    .map((reading) => reading.soilMoistureRaw as number);

  const lowRaw = percentile(rawValues, 0.1);
  const highRaw = percentile(rawValues, 0.9);
  const wetRaw = wetCandidates.length >= 2 ? percentile(wetCandidates, 0.2) : lowRaw;
  const dryRaw = dryCandidates.length >= 2 ? percentile(dryCandidates, 0.8) : highRaw;
  const hasUsefulRange = typeof dryRaw === "number" && typeof wetRaw === "number" && dryRaw - wetRaw >= 2500;

  return {
    moistureDryRaw: hasUsefulRange ? clampInt(dryRaw + 800, 0, 65535) : plant.moistureDryRaw,
    moistureWetRaw: hasUsefulRange ? clampInt(wetRaw - 800, 0, 65535) : plant.moistureWetRaw,
    confidence: hasUsefulRange ? Math.min(0.85, 0.45 + rawValues.length / 80) : 0.25,
    appliedFromHistory: hasUsefulRange,
    reason: hasUsefulRange
      ? "Calibration humidite ajustee depuis la plage brute observee recemment."
      : "Pas assez de variation brute fiable pour recalibrer le capteur humidite; les bornes actuelles sont conservees."
  };
}

export function buildCalibrationResearchPrompt(
  plant: Pick<Plant, "name" | "species" | "location" | "notes" | "targetMoisture" | "minLightLux" | "minSoilTempC" | "maxSoilTempC">,
  readings: Pick<Reading, "recordedAt" | "soilMoisturePct" | "soilTempC" | "airTempC" | "airHumidityPct" | "lightLux">[]
) {
  const recentReadings = readings
    .slice(0, 16)
    .map((reading) => {
      const parts = [
        `date=${reading.recordedAt.toISOString()}`,
        `soil=${reading.soilMoisturePct?.toFixed(0) ?? "N/A"}%`,
        `soilTemp=${reading.soilTempC?.toFixed(1) ?? "N/A"}C`,
        `air=${reading.airTempC?.toFixed(1) ?? "N/A"}C`,
        `airHumidity=${reading.airHumidityPct?.toFixed(0) ?? "N/A"}%`,
        `light=${reading.lightLux?.toFixed(0) ?? "N/A"}lx`
      ];
      return parts.join(" ");
    })
    .join("\n");

  return `Tu es Arborisis, agent IA horticole. Fais une recherche web exhaustive avant de calibrer le profil de cette plante.

Plante:
- nom: ${plant.name}
- espece saisie: ${plant.species ?? "non specifiee"}
- lieu: ${plant.location ?? "non specifie"}
- notes: ${plant.notes ?? "aucune"}

Seuils actuels:
- humidite cible: ${plant.targetMoisture}%
- lumiere minimale: ${plant.minLightLux} lux
- temperature sol: ${plant.minSoilTempC}-${plant.maxSoilTempC} C

Mesures recentes:
${recentReadings || "Aucune mesure recente."}

Recherche web obligatoire:
- identifie l'espece la plus probable depuis le nom/espece/notes;
- recoupe au moins 4 sources web horticoles ou botaniques distinctes quand possible;
- privilegie les besoins en lumiere, eau/substrat, temperature, et tolerance en interieur;
- convertis les besoins en valeurs utilisables par capteurs: humidite sol cible %, lumiere min lux, temperature sol min/max;
- ne mets pas une valeur agressive si les sources divergent: choisis un seuil prudent et explique la confiance.

Retourne uniquement ce JSON valide, sans markdown:
{
  "targetMoisture": 0-100,
  "minLightLux": 0-200000,
  "minSoilTempC": -20-60,
  "maxSoilTempC": -20-80,
  "confidence": 0-1,
  "researchedName": "nom botanique ou commun retenu",
  "reason": "justification courte avec compromis entre sources et mesures recentes",
  "sources": [
    {"title": "titre", "url": "https://..."}
  ]
}`;
}

function boundedProfile(parsed: Record<string, unknown>): PlantProfileCalibration {
  const sources = Array.isArray(parsed.sources)
    ? parsed.sources
      .map((source) => source as Record<string, unknown>)
      .filter((source) => typeof source.title === "string" && typeof source.url === "string")
      .slice(0, 8)
      .map((source) => ({ title: source.title as string, url: source.url as string }))
    : [];

  return {
    targetMoisture: clampInt(requireNumber(parsed.targetMoisture, "targetMoisture"), 0, 100),
    minLightLux: clampInt(requireNumber(parsed.minLightLux, "minLightLux"), 0, 200000),
    minSoilTempC: Math.max(-20, Math.min(60, requireNumber(parsed.minSoilTempC, "minSoilTempC"))),
    maxSoilTempC: Math.max(-20, Math.min(80, requireNumber(parsed.maxSoilTempC, "maxSoilTempC"))),
    confidence: Math.max(0, Math.min(1, requireNumber(parsed.confidence, "confidence"))),
    researchedName: typeof parsed.researchedName === "string" ? parsed.researchedName : "espece recherchee",
    reason: typeof parsed.reason === "string" ? parsed.reason : "Profil calibre par recherche web.",
    sources
  };
}

export function parseProfileCalibration(content: string): PlantProfileCalibration {
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/)?.[1] ?? content;
  const parsed = JSON.parse(jsonMatch) as Record<string, unknown>;
  return boundedProfile(parsed);
}
