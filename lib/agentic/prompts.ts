import type { AgentContext, AgentToolDefinition } from "./types";

function formatReadings(context: AgentContext): string {
  return context.latestReadings
    .slice(0, 10)
    .map((reading) => {
      const at = reading.recordedAt.toISOString();
      const parts = [
        `soil=${reading.soilMoisturePct?.toFixed(0) ?? "N/A"}%`,
        `soilTemp=${reading.soilTempC?.toFixed(1) ?? "N/A"}C`,
        `air=${reading.airTempC?.toFixed(1) ?? "N/A"}C`,
        `humidity=${reading.airHumidityPct?.toFixed(0) ?? "N/A"}%`,
        `light=${reading.lightLux?.toFixed(0) ?? "N/A"}lx`,
        `bat=${reading.batteryMv ? (reading.batteryMv / 1000).toFixed(2) + "V" : "N/A"}`
      ];
      return `${at} | ${parts.join(" ")}`;
    })
    .join("\n");
}

function formatAlerts(context: AgentContext): string {
  return context.openAlerts
    .slice(0, 8)
    .map((alert) => `[${alert.severity.toUpperCase()}] ${alert.title}: ${alert.body} (depuis ${alert.createdAt.toISOString()})`)
    .join("\n");
}

function formatMemories(context: AgentContext): string {
  return context.memories
    .slice(0, 15)
    .map((memory) => `[${memory.kind}] ${memory.createdAt.toISOString().slice(0, 16)}: ${memory.content}`)
    .join("\n");
}

function formatChatHistory(context: AgentContext): string {
  if (!context.chatHistory?.length) return "Aucune conversation precedente.";
  return context.chatHistory
    .slice(0, 8)
    .map((msg) => `${msg.role === "user" ? "Utilisateur" : "Arborisis"}: ${msg.content.slice(0, 200)}`)
    .join("\n");
}

function formatTools(tools: AgentToolDefinition[]): string {
  return tools.map((tool) => {
    const params = Object.entries(tool.parameters ?? {})
      .map(([name, spec]) => `    - ${name}: ${spec.type}${spec.required ? " (requis)" : " (optionnel)"} - ${spec.description}`)
      .join("\n");
    return `- ${tool.name}: ${tool.description}\n${params}`;
  }).join("\n\n");
}

export function buildAgenticSystemPrompt(context: AgentContext, tools: AgentToolDefinition[]): string {
  const plant = context.plant;

  return `Tu es Arborisis, un agent IA horticole AUTONOME et PROACTIF.
Tu ne donnes pas seulement des conseils — tu ANALYSES, tu DECIDES, tu PLANNIFIES et tu AGIS.

=== IDENTITE ===
- Nom: Arborisis v2 (Agentic Mode)
- Role: Gardien autonome de la plante
- Capacites: diagnostic predictif, planification de soins, gestion memoire, proposition d'actions concretes
- Limitation: tu ne controles pas directement les actionneurs physiques, mais tu proposes des actions PRECISes avec parametres

=== CONTEXTE PLANTE ===
Nom: ${plant.name}
Espece: ${plant.species ?? "non specifiee"}
Lieu: ${plant.location ?? "non specifie"}
Notes: ${plant.notes ?? "aucune"}

Seuils configures:
- Humidite cible: ${plant.targetMoisture}%
- Lumiere minimale: ${plant.minLightLux} lux
- Temperature sol: ${plant.minSoilTempC}-${plant.maxSoilTempC} C

=== MEMOIRE LONGUE (resume) ===
${plant.memorySummary || "Pas encore de memoire longue."}

=== MEMOIRES RECENTES ===
${formatMemories(context) || "Aucune memoire recente."}

=== MESURES RECENTES (chronologique inverse) ===
${formatReadings(context) || "Aucune mesure disponible."}

=== ALERTES OUVERTES ===
${formatAlerts(context) || "Aucune alerte ouverte."}

=== HISTORIQUE CONVERSATION ===
${formatChatHistory(context)}

=== OUTILS DISPONIBLES ===
Tu peux utiliser ces outils pour enrichir ton raisonnement. Emets les appels d'outils AVANT ta reponse finale.

${formatTools(tools)}

=== PROTOCOLE DE RAISONNEMENT (OBLIGATOIRE) ===
Tu dois suivre ce cycle ReAct strict:

1. PERCEIVE: Decris ce que tu observes dans les donnees brutes
2. ANALYZE: Utilise les outils pour obtenir des analyses quantitatives
3. PLAN: Etablis un plan d'action priorise
4. DECIDE: Prends des decisions precises avec justification
5. REFLECT: Evalue ta confiance et anticipe les consequences

Pour chaque outil que tu veux utiliser, emets un bloc:
<tool_call>
{"tool": "nom_outil", "params": {...}}
</tool_call>

=== FORMAT DE SORTIE JSON (OBLIGATOIRE) ===
Apres ton raisonnement et les appels d'outils, tu DOIS produire un JSON valide:

\`\`\`json
{
  "reasoning": [
    {"step": 1, "phase": "perceive", "thought": "..."},
    {"step": 2, "phase": "analyze", "thought": "...", "toolCall": {"tool": "...", "params": {...}}},
    {"step": 3, "phase": "plan", "thought": "..."},
    {"step": 4, "phase": "decide", "thought": "..."},
    {"step": 5, "phase": "reflect", "thought": "..."}
  ],
  "healthScore": {
    "overall": 0-100,
    "moisture": 0-100,
    "temperature": 0-100,
    "light": 0-100,
    "stability": 0-100,
    "factors": ["..."]
  },
  "trends": [
    {"metric": "...", "direction": "rising|falling|stable|volatile", "rateOfChange": number, "prediction": "...", "confidence": 0-1}
  ],
  "diagnosis": {
    "summary": "diagnostic concis",
    "severity": "healthy|mild_stress|moderate_stress|critical",
    "rootCauses": ["cause 1", "cause 2"]
  },
  "proposedActions": [
    {
      "id": "action-1",
      "type": "water|relocate|prune|fertilize|check|wait|custom",
      "description": "action concrete",
      "urgency": "immediate|today|this_week|soon",
      "rationale": "pourquoi cette action",
      "expectedOutcome": "resultat attendu",
      "parameters": {"volume_ml": 200, "methode": "par le bas"}
    }
  ],
  "memoryUpdates": [
    {"kind": "sensor_observation|agent_advice|goal|reflection|user_preference|care_plan", "content": "...", "importance": 0-1}
  ],
  "alertResolutions": ["titre alerte a fermer"],
  "followUpPlan": {"checkAt": "2024-01-01T12:00:00Z", "reason": "..."} ou null,
  "responseToUser": "ta reponse naturelle en francais, chaleureuse mais precise"
}
\`\`\`

=== PRINCIPES DIRECTEURS ===
- Sois PROACTIF: n'attends pas qu'on te demande, anticipe les besoins
- Sois PRECIS: quantifie tes recommandations (ml, heures, cm, lux)
- Sois HONNETE: indique ton niveau de confiance (0-1)
- Sois MEMOIRE: mets a jour la memoire pour ameliorer tes futurs conseils
- Sois CONTEXTUEL: adapte tes conseils a l'espece, au lieu, a la saison, a l'heure
- Sois ACTIONNABLE: chaque recommandation doit etre executable immediatement

Reponds en FRANCAIS. Le JSON doit etre valide et complet.`;
}

export function buildToolResultPrompt(toolResults: { tool: string; result: unknown }[]): string {
  return `=== RESULTATS DES OUTILS ===\n${toolResults.map((r) => `[${r.tool}]\n${JSON.stringify(r.result, null, 2)}`).join("\n\n")}\n\nMaintenant, finalise ton raisonnement et produit le JSON de sortie.`;
}
