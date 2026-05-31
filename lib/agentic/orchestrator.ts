import type { CalendarEvent, PrismaClient } from "@prisma/client";
import type {
  AgentContext,
  AgentStructuredOutput,
  AgentExecutionResult,
  AgentToolCall,
  CareScheduleItem,
  ResearchSource
} from "./types";
import { AGENT_TOOLS, createToolExecutor } from "./tools";
import { buildAgenticSystemPrompt, buildToolResultPrompt } from "./prompts";
import { persistMemories, updateMemorySummary, closeResolvedAlerts, CONVERSATION_KEEP_WINDOW } from "./memory";
import { callOpenRouter } from "./llm";

const TOOL_CALL_REGEX = /<tool_call>\s*({[\s\S]*?})\s*<\/tool_call>/g;
const JSON_BLOCK_REGEX = /```(?:json)?\s*([\s\S]*?)\s*```/i;

function mergeWebSources(sources: ResearchSource[]) {
  const seen = new Set<string>();
  const merged: ResearchSource[] = [];
  for (const source of sources) {
    if (!source.url || seen.has(source.url)) continue;
    seen.add(source.url);
    merged.push(source);
  }
  return merged.slice(0, 8);
}

function parseToolCalls(content: string): AgentToolCall[] {
  const calls: AgentToolCall[] = [];
  let match;
  while ((match = TOOL_CALL_REGEX.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.tool && typeof parsed.params === "object") {
        calls.push({ tool: parsed.tool, params: parsed.params });
      }
    } catch {
      // ignore malformed tool calls
    }
  }
  return calls;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStructuredOutputCandidate(value: unknown) {
  if (!isRecord(value)) return false;
  return Boolean(
    value.diagnosis ||
    value.healthScore ||
    value.responseToUser ||
    value.proposedActions ||
    value.careSchedule
  );
}

function extractUnclosedJsonFence(content: string) {
  const openingFence = /```(?:json)?\s*/i.exec(content);
  if (!openingFence) return null;

  const start = openingFence.index + openingFence[0].length;
  const closingFence = content.indexOf("```", start);
  return content.slice(start, closingFence === -1 ? undefined : closingFence).trim();
}

function extractBalancedJsonObjects(content: string) {
  const objects: string[] = [];

  for (let start = content.indexOf("{"); start !== -1; start = content.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < content.length; index += 1) {
      const char = content[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
      } else if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          objects.push(content.slice(start, index + 1));
          break;
        }
      }
    }
  }

  return objects;
}

function parseJsonCandidate(candidate: string) {
  try {
    return JSON.parse(candidate.trim());
  } catch {
    return null;
  }
}

function extractStructuredJson(content: string) {
  const candidates = [
    JSON_BLOCK_REGEX.exec(content)?.[1],
    extractUnclosedJsonFence(content),
    ...extractBalancedJsonObjects(content),
    content
  ].filter((candidate): candidate is string => Boolean(candidate?.trim()));

  for (const candidate of candidates) {
    const direct = parseJsonCandidate(candidate);
    if (isStructuredOutputCandidate(direct)) return direct;

    for (const nested of extractBalancedJsonObjects(candidate)) {
      const parsed = parseJsonCandidate(nested);
      if (isStructuredOutputCandidate(parsed)) return parsed;
    }
  }

  return null;
}

function parseStructuredOutput(content: string): AgentStructuredOutput {
  const parsed = extractStructuredJson(content);
  return parsed ? validateStructuredOutput(parsed) : createFallbackOutput(content);
}

const CALENDAR_CATEGORIES = new Set(["water", "relocate", "prune", "fertilize", "check", "wait", "custom"]);
const CALENDAR_PRIORITIES = new Set(["high", "medium", "low"]);

function normalizeCalendarCategory(value: string) {
  return CALENDAR_CATEGORIES.has(value) ? value : "custom";
}

function normalizeCalendarPriority(value: string) {
  return CALENDAR_PRIORITIES.has(value) ? value : "medium";
}

async function persistCareScheduleEvents(
  prisma: PrismaClient,
  plantId: string,
  careSchedule: CareScheduleItem[]
) {
  const persisted: CalendarEvent[] = [];
  const now = Date.now();

  for (const task of careSchedule.slice(0, 12)) {
    const startsAt = new Date(task.dueAt);
    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() < now - 86400000) continue;

    const windowStart = new Date(startsAt.getTime() - 45 * 60000);
    const windowEnd = new Date(startsAt.getTime() + 45 * 60000);
    const existing = await prisma.calendarEvent.findFirst({
      where: {
        plantId,
        source: "agent",
        title: task.title,
        startsAt: { gte: windowStart, lte: windowEnd },
        status: { not: "skipped" }
      }
    });

    if (existing) continue;

    const event = await prisma.calendarEvent.create({
      data: {
        plantId,
        title: task.title.slice(0, 120),
        description: task.successCriteria,
        startsAt,
        category: normalizeCalendarCategory(task.actionType),
        priority: normalizeCalendarPriority(task.priority),
        status: "planned",
        source: "agent"
      }
    });
    persisted.push(event);
  }

  return persisted;
}

function validateStructuredOutput(parsed: unknown): AgentStructuredOutput {
  const p = isRecord(parsed) ? parsed : {};
  const healthScore = isRecord(p.healthScore) ? p.healthScore : {};
  const diagnosis = isRecord(p.diagnosis) ? p.diagnosis : {};
  const severity = diagnosis.severity;
  const validSeverity =
    severity === "healthy" ||
    severity === "mild_stress" ||
    severity === "moderate_stress" ||
    severity === "critical";
  const readScore = (key: string, fallback: number) => {
    const value = Number(healthScore[key]);
    if (!Number.isFinite(value)) return fallback;
    return Math.max(0, Math.min(100, Math.round(value)));
  };

  const hasAnalysisPayload = Boolean(
    (Array.isArray(p.proposedActions) && p.proposedActions.length) ||
    (Array.isArray(p.careSchedule) && p.careSchedule.length) ||
    (Array.isArray(p.trends) && p.trends.length) ||
    (typeof diagnosis.summary === "string" && diagnosis.summary && diagnosis.summary !== "Diagnostic non disponible")
  );
  const mode: AgentStructuredOutput["mode"] =
    p.mode === "chat" || p.mode === "analysis"
      ? p.mode
      : hasAnalysisPayload ? "analysis" : "chat";

  return {
    mode,
    reasoning: Array.isArray(p.reasoning) ? p.reasoning : [{ step: 1, phase: "perceive", thought: "Raisonnement non structure" }],
    healthScore: {
      overall: readScore("overall", 50),
      moisture: readScore("moisture", 50),
      temperature: readScore("temperature", 50),
      light: readScore("light", 50),
      stability: readScore("stability", 50),
      factors: Array.isArray(healthScore.factors) ? healthScore.factors.map(String) : ["Donnees insuffisantes"]
    },
    trends: Array.isArray(p.trends) ? p.trends : [],
    diagnosis: {
      summary: typeof diagnosis.summary === "string" ? diagnosis.summary : "Diagnostic non disponible",
      severity: validSeverity ? severity : "mild_stress",
      rootCauses: Array.isArray(diagnosis.rootCauses) ? diagnosis.rootCauses.map(String) : []
    },
    proposedActions: Array.isArray(p.proposedActions) ? p.proposedActions : [],
    careSchedule: Array.isArray(p.careSchedule) ? p.careSchedule : [],
    webSources: Array.isArray(p.webSources) ? p.webSources : [],
    memoryUpdates: Array.isArray(p.memoryUpdates) ? p.memoryUpdates : [],
    alertResolutions: Array.isArray(p.alertResolutions) ? p.alertResolutions : [],
    followUpPlan: p.followUpPlan as AgentStructuredOutput["followUpPlan"] ?? null,
    responseToUser: typeof p.responseToUser === "string" ? p.responseToUser : "Je n'ai pas pu formuler de reponse structuree."
  };
}

function createFallbackOutput(content: string): AgentStructuredOutput {
  return {
    mode: "chat",
    reasoning: [{ step: 1, phase: "perceive", thought: "Reponse brute sans structure JSON" }],
    healthScore: {
      overall: 50, moisture: 50, temperature: 50, light: 50, stability: 50,
      factors: ["Sortie non structuree"]
    },
    trends: [],
    diagnosis: { summary: "Non disponible", severity: "mild_stress", rootCauses: [] },
    proposedActions: [],
    careSchedule: [],
    webSources: [],
    memoryUpdates: [{ kind: "agent_advice", content: content.slice(0, 500), importance: 0.5 }],
    alertResolutions: [],
    followUpPlan: null,
    responseToUser: content
  };
}

export async function runAgenticLoop(
  prisma: PrismaClient,
  context: AgentContext,
  options?: { webSearch?: boolean }
): Promise<AgentExecutionResult> {
  const tools = createToolExecutor(
    context.plant,
    context.latestReadings,
    context.weather,
    context.recentPhotos ?? [],
    context.calendarEvents ?? []
  );
  const webSearch = options?.webSearch ?? true;
  const systemPrompt = buildAgenticSystemPrompt(context, AGENT_TOOLS, { webSearch });

  // Conversation multi-tours: on envoie la fenetre recente en vrais tours user/assistant
  // (le resume des tours plus anciens est deja injecte dans le system prompt).
  const history = (context.chatHistory ?? [])
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const recentTurns = history.slice(-CONVERSATION_KEEP_WINDOW).map((msg) => ({
    role: msg.role === "user" ? "user" : "assistant",
    content: msg.content
  }));

  const initialMessages: Array<{ role: string; content: string }> = [
    { role: "system", content: systemPrompt },
    ...recentTurns
  ];
  if (!recentTurns.some((turn) => turn.role === "user")) {
    initialMessages.push({
      role: "user",
      content: "Analyse l'etat actuel de la plante et propose un plan d'action."
    });
  }

  // Phase 1: raisonnement initial + eventuels appels d'outils
  const phase1 = await callOpenRouter(initialMessages, { webSearch });
  const toolCalls = parseToolCalls(phase1.content);

  const executedTools: { tool: string; result: unknown }[] = [];
  let structuredOutput: AgentStructuredOutput;
  let phase3WebSources: ResearchSource[] = [];
  let phase3Requests = 0;

  if (toolCalls.length) {
    // Phase 2: execution des outils demandes
    for (const call of toolCalls) {
      const executor = (tools as Record<string, (params: unknown) => unknown>)[call.tool];
      if (executor) {
        try {
          const result = executor(call.params);
          executedTools.push({ tool: call.tool, result });
        } catch (error) {
          executedTools.push({ tool: call.tool, result: { error: String(error) } });
        }
      }
    }

    // Phase 3: synthese finale avec les resultats d'outils
    const phase3Messages = [
      ...initialMessages,
      { role: "assistant", content: phase1.content },
      { role: "user", content: buildToolResultPrompt(executedTools) }
    ];
    const phase3 = await callOpenRouter(phase3Messages, { webSearch });
    structuredOutput = parseStructuredOutput(phase3.content);
    phase3WebSources = phase3.webSources;
    phase3Requests = phase3.webSearchRequests;
  } else {
    // Tour simple: pas d'outil demande. Si un JSON structure est deja present on l'utilise,
    // sinon on traite la reponse comme un message conversationnel (mode chat) -> 1 seul appel LLM.
    const direct = extractStructuredJson(phase1.content);
    structuredOutput = direct ? validateStructuredOutput(direct) : createFallbackOutput(phase1.content);
  }

  const webSources = mergeWebSources([
    ...phase1.webSources,
    ...phase3WebSources,
    ...structuredOutput.webSources
  ]);
  structuredOutput.webSources = webSources;

  // Phase 4: Persistence
  const plantId = context.plant.id;

  // Persist memories
  const persistedMemories = await persistMemories(prisma, plantId, structuredOutput.memoryUpdates);

  // Close resolved alerts
  const closedAlertMemories = await closeResolvedAlerts(prisma, plantId, structuredOutput.alertResolutions);

  // Persist care schedule to the app calendar
  const persistedCalendarEvents = await persistCareScheduleEvents(prisma, plantId, structuredOutput.careSchedule);

  // Update memory summary
  const updatedSummary = await updateMemorySummary(
    prisma,
    plantId,
    context.plant.memorySummary,
    structuredOutput.memoryUpdates
  );

  if (updatedSummary) {
    await prisma.plant.update({
      where: { id: plantId },
      data: { memorySummary: updatedSummary }
    });
  }

  return {
    structuredOutput,
    executedTools,
    webSources,
    webSearchRequests: phase1.webSearchRequests + phase3Requests,
    persistedMemories,
    closedAlertMemories,
    persistedCalendarEvents,
    updatedSummary
  };
}

export function buildStreamingResponse(result: AgentExecutionResult): string {
  const { structuredOutput } = result;

  // Mode conversationnel: reponse naturelle uniquement, sans cartes de diagnostic.
  // Le bloc JSON final (avec `mode`) reste embarque pour un parsing frontend fiable.
  if (structuredOutput.mode === "chat") {
    const chatPayload = {
      mode: "chat",
      responseToUser: structuredOutput.responseToUser,
      webSources: structuredOutput.webSources
    };
    const parts = [structuredOutput.responseToUser];
    if (structuredOutput.webSources.length) {
      parts.push("\n## Sources web:");
      structuredOutput.webSources.forEach((source) => parts.push(`- ${source.title}: ${source.url}`));
    }
    parts.push(`\n\`\`\`json\n${JSON.stringify(chatPayload)}\n\`\`\``);
    return parts.join("\n");
  }

  // Build a rich streaming response that includes reasoning and actions
  const sections: string[] = [];

  // Diagnosis
  sections.push(`## Diagnostic: ${structuredOutput.diagnosis.severity.toUpperCase()}`);
  sections.push(structuredOutput.diagnosis.summary);
  if (structuredOutput.diagnosis.rootCauses.length) {
    sections.push("\nCauses identifiees:");
    structuredOutput.diagnosis.rootCauses.forEach((cause) => sections.push(`- ${cause}`));
  }

  // Health Score
  sections.push(`\n## Score de sante: ${structuredOutput.healthScore.overall}/100`);
  sections.push(`Humidite: ${structuredOutput.healthScore.moisture}% | Temperature: ${structuredOutput.healthScore.temperature}% | Lumiere: ${structuredOutput.healthScore.light}% | Stabilite: ${structuredOutput.healthScore.stability}%`);

  // Trends
  if (structuredOutput.trends.length) {
    sections.push("\n## Tendances:");
    structuredOutput.trends.forEach((t) => {
      sections.push(`- ${t.metric}: ${t.direction} (${t.prediction}) [confiance: ${Math.round(t.confidence * 100)}%]`);
    });
  }

  // Actions
  if (structuredOutput.proposedActions.length) {
    sections.push("\n## Actions proposees:");
    structuredOutput.proposedActions.forEach((action) => {
      sections.push(`\n[${action.urgency.toUpperCase()}] ${action.description}`);
      sections.push(`  Justification: ${action.rationale}`);
      sections.push(`  Resultat attendu: ${action.expectedOutcome}`);
      if (action.parameters && Object.keys(action.parameters).length > 0) {
        const params = Object.entries(action.parameters).map(([k, v]) => `${k}=${v}`).join(", ");
        sections.push(`  Parametres: ${params}`);
      }
    });
  }

  // Care schedule
  if (structuredOutput.careSchedule.length) {
    sections.push("\n## Planning de soins:");
    structuredOutput.careSchedule.forEach((task) => {
      sections.push(`- [${task.priority.toUpperCase()}] ${task.title} - ${task.dueAt}`);
      sections.push(`  Type: ${task.actionType} | Cadence: ${task.cadence}`);
      sections.push(`  Critere de reussite: ${task.successCriteria}`);
    });
    if (result.persistedCalendarEvents.length) {
      sections.push(`\n${result.persistedCalendarEvents.length} tache${result.persistedCalendarEvents.length > 1 ? "s" : ""} ajoutee${result.persistedCalendarEvents.length > 1 ? "s" : ""} au calendrier.`);
    }
  }

  // Web sources
  if (structuredOutput.webSources.length) {
    sections.push("\n## Sources web:");
    structuredOutput.webSources.forEach((source) => {
      sections.push(`- ${source.title}: ${source.url}`);
    });
  }

  if (result.executedTools.length || result.webSearchRequests > 0) {
    sections.push("\n## Outils executes:");
    result.executedTools.forEach((tool) => sections.push(`- ${tool.tool}`));
    if (result.webSearchRequests > 0) {
      sections.push(`- openrouter:web_search (${result.webSearchRequests} requete${result.webSearchRequests > 1 ? "s" : ""})`);
    }
  }

  // Follow-up
  if (structuredOutput.followUpPlan) {
    sections.push(`\n## Suivi prevu: ${structuredOutput.followUpPlan.reason} (${structuredOutput.followUpPlan.checkAt})`);
  }

  // Response to user
  sections.push(`\n---\n${structuredOutput.responseToUser}`);

  // Embed structured JSON at end for reliable frontend parsing
  const frontendPayload = {
    mode: "analysis",
    diagnosis: structuredOutput.diagnosis,
    healthScore: structuredOutput.healthScore,
    proposedActions: structuredOutput.proposedActions,
    careSchedule: structuredOutput.careSchedule,
    webSources: structuredOutput.webSources,
    responseToUser: structuredOutput.responseToUser
  };
  sections.push(`\n\`\`\`json\n${JSON.stringify(frontendPayload)}\n\`\`\``);

  return sections.join("\n");
}
