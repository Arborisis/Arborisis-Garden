type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type PlantPhotoAnalysis = {
  summary: string;
  observations: string[];
  recommendations: string[];
  healthScore: number | null;
  confidence: number;
};

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function extractBalancedJsonObjects(text: string) {
  const objects: string[] = [];

  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < text.length; index += 1) {
      const char = text[index];

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
          objects.push(text.slice(start, index + 1));
          break;
        }
      }
    }
  }

  return objects;
}

function parsePhotoAnalysis(content: string): PlantPhotoAnalysis {
  const fenced = /```(?:json)?\s*([\s\S]*?)(?:```|$)/i.exec(content)?.[1];
  const candidates = [
    fenced,
    ...extractBalancedJsonObjects(fenced ?? ""),
    ...extractBalancedJsonObjects(content),
    content
  ].filter((candidate): candidate is string => Boolean(candidate?.trim()));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim()) as Record<string, unknown>;
      const summary = typeof parsed.summary === "string" ? parsed.summary : "";
      if (!summary) continue;
      const observations = Array.isArray(parsed.observations) ? parsed.observations.map(String).slice(0, 8) : [];
      const recommendations = Array.isArray(parsed.recommendations) ? parsed.recommendations.map(String).slice(0, 8) : [];
      const score = parsed.healthScore == null ? null : Math.round(clampNumber(parsed.healthScore, 0, 100, 50));

      return {
        summary,
        observations,
        recommendations,
        healthScore: score,
        confidence: clampNumber(parsed.confidence, 0, 1, 0.5)
      };
    } catch {
      continue;
    }
  }

  return {
    summary: content.slice(0, 900) || "Analyse image non structuree.",
    observations: [],
    recommendations: [],
    healthScore: null,
    confidence: 0.35
  };
}

export async function streamOpenRouter(messages: ChatMessage[]) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return new Response(
      "OPENROUTER_API_KEY est absent. Ajoute-le dans .env.local pour activer l'agent IA.",
      { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
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
      stream: true,
      temperature: 0.45,
      messages
    })
  });

  if (!response.ok || !response.body) {
    const errorText = await response.text();
    return new Response(`Erreur OpenRouter: ${errorText}`, {
      status: 502,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const reader = response.body!.getReader();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") continue;

          try {
            const json = JSON.parse(payload);
            const text = json.choices?.[0]?.delta?.content;
            if (text) controller.enqueue(encoder.encode(text));
          } catch {
            continue;
          }
        }
      }

      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache"
    }
  });
}

export async function analyzePlantPhotoWithOpenRouter(input: {
  imageDataUrl: string;
  plantContext: string;
  title?: string;
}): Promise<PlantPhotoAnalysis> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return {
      summary: "Analyse IA indisponible: OPENROUTER_API_KEY n'est pas configure.",
      observations: [],
      recommendations: ["Configurer OPENROUTER_API_KEY pour activer l'analyse photo par OpenRouter."],
      healthScore: null,
      confidence: 0
    };
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
      model: process.env.OPENROUTER_VISION_MODEL ?? process.env.OPENROUTER_MODEL ?? "anthropic/claude-3.5-sonnet",
      stream: false,
      temperature: 0.2,
      max_tokens: 1200,
      messages: [
        {
          role: "system",
          content:
            "Tu es un expert horticole qui analyse des photos de plantes. Reponds uniquement avec un JSON valide: " +
            "{\"summary\":\"...\",\"observations\":[\"...\"],\"recommendations\":[\"...\"],\"healthScore\":0-100|null,\"confidence\":0-1}. " +
            "Ne diagnostique pas une maladie avec certitude depuis une image seule; indique les incertitudes."
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                `Titre photo: ${input.title || "photo plante"}\n` +
                `${input.plantContext}\n\n` +
                "Analyse les signes visibles: feuilles, couleur, taches, port, substrat visible, stress hydrique/lumiere, et donne des actions concretes."
            },
            {
              type: "image_url",
              image_url: { url: input.imageDataUrl }
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erreur OpenRouter vision: ${errorText}`);
  }

  const json = await response.json();
  const content = json.choices?.[0]?.message?.content;
  return parsePhotoAnalysis(typeof content === "string" ? content : JSON.stringify(content ?? ""));
}
