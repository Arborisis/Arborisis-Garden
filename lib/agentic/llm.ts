import type { ResearchSource } from "./types";
import { resolveAgentModel, samplingParams, reasoningParams } from "../llm-models";

export type LlmMessage = { role: string; content: string };

export type OpenRouterResult = {
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

export function buildOpenRouterWebTool() {
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

/**
 * Single OpenRouter chat-completion call. Shared by the agentic orchestrator
 * (reasoning + synthesis) and the conversation auto-compaction in memory.ts.
 */
export async function callOpenRouter(
  messages: LlmMessage[],
  options?: { webSearch?: boolean; temperature?: number; model?: string; reasoning?: boolean }
): Promise<OpenRouterResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY manquant");
  }

  const model = options?.model ?? resolveAgentModel();
  const body: Record<string, unknown> = {
    model,
    stream: false,
    ...samplingParams(model, options?.temperature ?? 0.15),
    ...(options?.reasoning === false ? {} : reasoningParams()),
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
