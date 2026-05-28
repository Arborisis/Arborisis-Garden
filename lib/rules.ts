import type { Plant, Reading } from "@prisma/client";

export type RuleAlert = {
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
};

export function evaluateReading(plant: Plant, reading: Reading): RuleAlert[] {
  const alerts: RuleAlert[] = [];

  if (
    typeof reading.soilMoisturePct === "number" &&
    reading.soilMoisturePct < plant.targetMoisture - 15
  ) {
    alerts.push({
      severity: reading.soilMoisturePct < plant.targetMoisture - 28 ? "critical" : "warning",
      title: "Sol trop sec",
      body: `${plant.name} est a ${reading.soilMoisturePct.toFixed(0)}% d'humidite sol, sous la cible de ${plant.targetMoisture}%.`
    });
  }

  if (
    typeof reading.soilTempC === "number" &&
    (reading.soilTempC < plant.minSoilTempC || reading.soilTempC > plant.maxSoilTempC)
  ) {
    alerts.push({
      severity: "warning",
      title: "Temperature du sol hors zone",
      body: `Le sol est a ${reading.soilTempC.toFixed(1)} C; zone attendue ${plant.minSoilTempC}-${plant.maxSoilTempC} C.`
    });
  }

  if (typeof reading.lightLux === "number" && reading.lightLux < plant.minLightLux) {
    alerts.push({
      severity: "info",
      title: "Lumiere faible",
      body: `La lumiere mesuree est ${reading.lightLux.toFixed(0)} lux, sous le seuil de ${plant.minLightLux} lux.`
    });
  }

  return alerts;
}

export function summarizeReading(reading: Reading): string {
  const parts = [
    reading.soilMoisturePct == null ? null : `sol ${reading.soilMoisturePct.toFixed(0)}%`,
    reading.soilTempC == null ? null : `temp sol ${reading.soilTempC.toFixed(1)} C`,
    reading.airTempC == null ? null : `air ${reading.airTempC.toFixed(1)} C`,
    reading.airHumidityPct == null ? null : `humidite air ${reading.airHumidityPct.toFixed(0)}%`,
    reading.lightLux == null ? null : `lumiere ${reading.lightLux.toFixed(0)} lux`
  ].filter(Boolean);

  return parts.length ? parts.join(", ") : "mesure recue sans valeurs capteurs exploitables";
}
