import type { PrismaClient } from "@prisma/client";
import type {
  AgentContext,
  AgentStructuredOutput,
  AgentExecutionResult,
  AgentReasoningStep,
  AgentToolCall
} from "./types";
import { AGENT_TOOLS, createToolExecutor } from "./tools";
import { buildAgenticSystemPrompt, buildToolResultPrompt } from "./prompts";
import { persistMemories, updateMemorySummary, closeResolvedAlerts } from "./memory";

const TOOL_CALL_REGEX = /<tool_call>\s*({[\s\S]*?})\s*<\/tool_call>/g;
const JSON_BLOCK_REGEX = /```(?:json)?\s*([\s\S]*?)\s*```/;

async function callOpenRouterForReasoning(messages: Array<{ role: string; content: string }>): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY manquant");
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost:3000",
      "X-Title": process.env.OPENROUTER_APP_NAME ?? "Arborisis Garden"
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL ?? "anthropic/claude-3.5-sonnet",
      stream: false,
      temperature: 0.35,
      max_tokens: 4000,
      messages
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter error: ${text}`);
  }

  const json = await response.json();
  return json.choices?.[0]?.message?.content ?? "";
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

function parseStructuredOutput(content: string): AgentStructuredOutput {
  // Try to find JSON block
  const match = JSON_BLOCK_REGEX.exec(content);
  const jsonStr = match?.[1] ?? content;

  try {
    const parsed = JSON.parse(jsonStr);
    return validateStructuredOutput(parsed);
  } catch {
    // Fallback: create minimal structured output from raw text
    return createFallbackOutput(content);
  }
}

function validateStructuredOutput(parsed: unknown): AgentStructuredOutput {
  const p = parsed as Record<string, unknown>;

  return {
    reasoning: Array.isArray(p.reasoning) ? p.reasoning : [{ step: 1, phase: "perceive", thought: "Raisonnement non structure" }],
    healthScore: p.healthScore as AgentStructuredOutput["healthScore"] ?? {
      overall: 50, moisture: 50, temperature: 50, light: 50, stability: 50, factors: ["Donnees insuffisantes"]
    },
    trends: Array.isArray(p.trends) ? p.trends : [],
    diagnosis: p.diagnosis as AgentStructuredOutput["diagnosis"] ?? {
      summary: "Diagnostic non disponible",
      severity: "mild_stress",
      rootCauses: []
    },
    proposedActions: Array.isArray(p.proposedActions) ? p.proposedActions : [],
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
    memoryUpdates: [{ kind: "agent_advice", content: content.slice(0, 500), importance: 0.5 }],
    alertResolutions: [],
    followUpPlan: null,
    responseToUser: content
  };
}

export async function runAgenticLoop(
  prisma: PrismaClient,
  context: AgentContext
): Promise<AgentExecutionResult> {
  const tools = createToolExecutor(context.plant, context.latestReadings);
  const systemPrompt = buildAgenticSystemPrompt(context, AGENT_TOOLS);

  // Phase 1: Initial reasoning with tool calls
  const initialMessages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: context.chatHistory?.at(-1)?.content ?? "Analyse l'etat actuel de la plante et propose un plan d'action." }
  ];

  const phase1Content = await callOpenRouterForReasoning(initialMessages);
  const toolCalls = parseToolCalls(phase1Content);

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
    { role: "assistant", content: phase1Content },
    { role: "user", content: buildToolResultPrompt(executedTools) }
  ];

  const phase3Content = await callOpenRouterForReasoning(phase3Messages);
  const structuredOutput = parseStructuredOutput(phase3Content);

  // Phase 4: Persistence
  const plantId = context.plant.id;

  // Persist memories
  const persistedMemories = await persistMemories(prisma, plantId, structuredOutput.memoryUpdates);

  // Close resolved alerts
  const closedAlertMemories = await closeResolvedAlerts(prisma, plantId, structuredOutput.alertResolutions);

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
    persistedMemories,
    closedAlertMemories,
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

  // Follow-up
  if (structuredOutput.followUpPlan) {
    sections.push(`\n## Suivi prevu: ${structuredOutput.followUpPlan.reason} (${structuredOutput.followUpPlan.checkAt})`);
  }

  // Response to user
  sections.push(`\n---\n${structuredOutput.responseToUser}`);

  return sections.join("\n");
}
