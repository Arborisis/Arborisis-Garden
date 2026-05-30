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
import { persistMemories, updateMemorySummary, closeResolvedAlerts } from "./memory";

const TOOL_CALL_REGEX = /<tool_call>\s*({[\s\S]*?})\s*<\/tool_call>/g;
const JSON_BLOCK_REGEX = /```(?:json)?\s*([\s\S]*?)\s*```/i;

type OpenRouterReasoningResult = {
  content: string;
  webSources: ResearchSource[];
  webSearchRequests: number;
};

type OpenRouterAnnotation = {
  type?: string;
  url_citation?: {
    url?: string;
    title?: string;
    content?: string;
  };
};

function readNumberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function buildOpenRouterWebTool() {
  const parameters: Record<string, unknown> = {
    engine: process.env.OPENROUTER_WEB_SEARCH_ENGINE ?? "auto",
    max_results: readNumberEnv("OPENROUTER_WEB_SEARCH_MAX_RESULTS", 5),
    max_total_results: readNumberEnv("OPENROUTER_WEB_SEARCH_MAX_TOTAL_RESULTS", 10)
  };

  const contextSize = process.env.OPENROUTER_WEB_SEARCH_CONTEXT_SIZE;
  if (contextSize === "low" || contextSize === "medium" || contextSize === "high") {
    parameters.search_context_size = contextSize;
  }

  return { type: "openrouter:web_search", parameters };
}

function extractWebSources(annotations: OpenRouterAnnotation[]): ResearchSource[] {
  return annotations
    .filter((annotation) => annotation.type === "url_citation" && annotation.url_citation?.url)
    .map((annotation) => ({
      title: annotation.url_citation?.title || annotation.url_citation?.url || "Source web",
      url: annotation.url_citation?.url || "",
      snippet: annotation.url_citation?.content?.slice(0, 260)
    }));
}

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

async function callOpenRouterForReasoning(
  messages: Array<{ role: string; content: string }>,
  options?: { webSearch?: boolean }
): Promise<OpenRouterReasoningResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY manquant");
  }

  const body: Record<string, unknown> = {
    model: process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4-6",
    stream: false,
    temperature: 0.15,
    messages
  };

  if (options?.webSearch) {
    body.tools = [buildOpenRouterWebTool()];
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost:3000",
      "X-Title": process.env.OPENROUTER_APP_NAME ?? "Arborisis Garden"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter error: ${text}`);
  }

  const json = await response.json();
  const message = json.choices?.[0]?.message;
  return {
    content: message?.content ?? "",
    webSources: extractWebSources(message?.annotations ?? []),
    webSearchRequests: Number(json.usage?.server_tool_use?.web_search_requests ?? 0)
  };
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

  return {
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

  // Phase 1: Initial reasoning with tool calls
  const latestUserMessage = context.chatHistory?.find((entry) => entry.role === "user")?.content;
  const initialMessages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: latestUserMessage ?? "Analyse l'etat actuel de la plante et propose un plan d'action." }
  ];

  const phase1 = await callOpenRouterForReasoning(initialMessages, { webSearch });
  const toolCalls = parseToolCalls(phase1.content);

  // Phase 2: Execute tools
  const executedTools: { tool: string; result: unknown }[] = [];
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

  // Phase 3: Final synthesis with tool results
  const phase3Messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: initialMessages[1].content },
    { role: "assistant", content: phase1.content },
    { role: "user", content: buildToolResultPrompt(executedTools) }
  ];

  const phase3 = await callOpenRouterForReasoning(phase3Messages, { webSearch });
  const structuredOutput = parseStructuredOutput(phase3.content);
  const webSources = mergeWebSources([
    ...phase1.webSources,
    ...phase3.webSources,
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
    webSearchRequests: phase1.webSearchRequests + phase3.webSearchRequests,
    persistedMemories,
    closedAlertMemories,
    persistedCalendarEvents,
    updatedSummary
  };
}

export function buildStreamingResponse(result: AgentExecutionResult): string {
  const { structuredOutput } = result;

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
