import type { Alert, ChatMessage, Memory, Plant, Reading } from "@prisma/client";

export type { AgentContext } from "./agentic/types";
export { runAgenticLoop, buildStreamingResponse } from "./agentic/orchestrator";

// Legacy prompt builder — garde pour compatibilite
export function buildSystemPrompt(context: {
  plant: Plant;
  latestReadings: Reading[];
  openAlerts: Alert[];
  memories: Memory[];
  chatHistory?: ChatMessage[];
}) {
  const latest = context.latestReadings
    .slice(0, 8)
    .map((reading) => {
      const at = reading.recordedAt.toISOString();
      return [
        at,
        reading.soilMoisturePct == null ? null : `soil=${reading.soilMoisturePct.toFixed(0)}%`,
        reading.soilTempC == null ? null : `soilTemp=${reading.soilTempC.toFixed(1)}C`,
        reading.airTempC == null ? null : `air=${reading.airTempC.toFixed(1)}C`,
        reading.airHumidityPct == null ? null : `airHumidity=${reading.airHumidityPct.toFixed(0)}%`,
        reading.lightLux == null ? null : `light=${reading.lightLux.toFixed(0)}lux`
      ]
        .filter(Boolean)
        .join(" ");
    })
    .join("\n");

  const alerts = context.openAlerts
    .slice(0, 6)
    .map((alert) => `${alert.severity}: ${alert.title} - ${alert.body}`)
    .join("\n");

  const memories = context.memories
    .slice(0, 10)
    .map((memory) => `${memory.kind}: ${memory.content}`)
    .join("\n");

  return `Tu es Arborisis, un compagnon IA horticole connecte a une plante reelle.
Tu dois donner des conseils pratiques, prudents et contextualises a partir des capteurs.
Tu peux agir de facon autonome uniquement sous forme informationnelle: diagnostic, alerte, rappel, plan d'entretien. Tu ne controles aucun actionneur physique.

Plante:
- nom: ${context.plant.name}
- espece: ${context.plant.species ?? "inconnue"}
- lieu: ${context.plant.location ?? "inconnu"}
- cible humidite sol: ${context.plant.targetMoisture}%
- lumiere minimale: ${context.plant.minLightLux} lux
- temperature sol cible: ${context.plant.minSoilTempC}-${context.plant.maxSoilTempC} C
- notes: ${context.plant.notes ?? "aucune"}

Memoire resumee:
${context.plant.memorySummary || "Aucune memoire longue pour l'instant."}

Memoires recentes:
${memories || "Aucune."}

Mesures recentes:
${latest || "Aucune mesure."}

Alertes ouvertes:
${alerts || "Aucune."}

Reponds en francais, avec une recommandation claire et une justification breve.`;
}
