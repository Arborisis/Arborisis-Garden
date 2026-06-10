import type { Plant, Reading, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { summarizeWeatherForAgent, type WeatherContext } from "@/lib/weather";
import { summarizeBioForAgent } from "@/lib/bioelectric/analysis";
import { resolveInsightsModel, samplingParams } from "@/lib/llm-models";

export const INSIGHTS_CACHE_KIND = "ai_insights_cache";
export const INSIGHTS_CACHE_TTL_MS = 4 * 60 * 60 * 1000;

const insightSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(700),
  tone: z.enum(["good", "watch", "urgent"])
});

const insightsPayloadSchema = z.object({
  insights: z.array(insightSchema).min(1).max(4)
});

export type AiInsight = z.infer<typeof insightSchema>;

type InsightCachePayload = {
  version: 2;
  generatedAt: string;
  expiresAt: string;
  weatherKey: string | null;
  insights: AiInsight[];
};

type PlantWithReadings = Plant & {
  readings: Reading[];
};

type InsightResult = {
  insights: AiInsight[];
  cached: boolean;
  generatedAt: string;
  expiresAt: string;
  weatherIncluded: boolean;
};

function parseCache(content: string, weatherKey: string | null): InsightCachePayload | null {
  try {
    const parsed = JSON.parse(content) as Partial<InsightCachePayload>;
    const insights = insightsPayloadSchema.parse({ insights: parsed.insights }).insights;

    if (parsed.version !== 2 || !parsed.generatedAt || !parsed.expiresAt || parsed.weatherKey !== weatherKey) {
      return null;
    }

    return {
      version: 2,
      generatedAt: parsed.generatedAt,
      expiresAt: parsed.expiresAt,
      weatherKey,
      insights
    };
  } catch {
    return null;
  }
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

function parseJsonCandidate(candidate: string) {
  const parsed = JSON.parse(candidate.trim()) as unknown;
  return Array.isArray(parsed) ? { insights: parsed } : parsed;
}

export function parseAiInsightsResponse(content: string): AiInsight[] {
  const fencedBlocks = [...content.matchAll(/```(?:json)?\s*([\s\S]*?)(?:```|$)/gi)]
    .map((match) => match[1]?.trim())
    .filter((block): block is string => Boolean(block));

  const candidates = [
    ...fencedBlocks,
    ...fencedBlocks.flatMap(extractBalancedJsonObjects),
    ...extractBalancedJsonObjects(content),
    content
  ];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);

    try {
      return insightsPayloadSchema.parse(parseJsonCandidate(trimmed)).insights;
    } catch {
      continue;
    }
  }

  throw new Error("Aucun objet JSON d'insights valide trouve dans la reponse OpenRouter");
}

function summarizeReading(reading: Reading) {
  return {
    recordedAt: reading.recordedAt.toISOString(),
    soilMoisturePct: reading.soilMoisturePct,
    soilTempC: reading.soilTempC,
    airTempC: reading.airTempC,
    airHumidityPct: reading.airHumidityPct,
    pressureHpa: reading.pressureHpa,
    lightLux: reading.lightLux,
    wifiRssi: reading.wifiRssi
  };
}

function compactNumber(value: number | null) {
  return typeof value === "number" ? Math.round(value * 10) / 10 : null;
}

function buildWeatherCacheKey(weather?: WeatherContext | null) {
  if (!weather) return null;

  return JSON.stringify({
    location: {
      label: weather.location.label,
      latitude: Math.round(weather.location.latitude * 100) / 100,
      longitude: Math.round(weather.location.longitude * 100) / 100,
      timezone: weather.location.timezone
    },
    current: {
      time: weather.current.time,
      code: weather.current.weatherCode,
      temperatureC: compactNumber(weather.current.temperatureC),
      humidityPct: compactNumber(weather.current.humidityPct),
      windSpeedKmh: compactNumber(weather.current.windSpeedKmh)
    },
    today: {
      date: weather.today.date,
      precipitationSumMm: compactNumber(weather.today.precipitationSumMm),
      precipitationProbabilityMaxPct: compactNumber(weather.today.precipitationProbabilityMaxPct),
      temperatureMaxC: compactNumber(weather.today.temperatureMaxC),
      uvIndexMax: compactNumber(weather.today.uvIndexMax),
      evapotranspirationMm: compactNumber(weather.today.evapotranspirationMm)
    },
    gardening: {
      wateringWindow: weather.gardening.wateringWindow
    }
  });
}

function buildInsightsPrompt(plant: PlantWithReadings, weather?: WeatherContext | null, bioText?: string) {
  const readings = plant.readings
    .slice(0, 24)
    .reverse()
    .map(summarizeReading);

  return `Tu es Arborisis, un LLM horticole qui genere des insights IA courts pour un tableau de bord de plante connectee.

Plante:
${JSON.stringify({
    name: plant.name,
    species: plant.species,
    location: plant.location,
    notes: plant.notes,
    targetMoisture: plant.targetMoisture,
    minLightLux: plant.minLightLux,
    minSoilTempC: plant.minSoilTempC,
    maxSoilTempC: plant.maxSoilTempC,
    memorySummary: plant.memorySummary
  }, null, 2)}

Mesures recentes, ordre chronologique:
${JSON.stringify(readings, null, 2)}

Meteo locale du site:
${weather ? summarizeWeatherForAgent(weather) : "Meteo indisponible pour cette generation d'insights."}

Signal bioelectrique (2e capteur, biopotentiel de la plante):
${bioText && bioText.length ? bioText : "Aucun capteur bioelectrique actif sur cette plante."}

Reponds uniquement avec un objet JSON valide:
{
  "insights": [
    { "title": "titre court", "body": "conseil concret en francais", "tone": "good|watch|urgent" }
  ]
}

Contraintes:
- 1 a 4 insights maximum.
- Francais simple, utile, sans markdown.
- "urgent" seulement si une action rapide est prudente.
- "watch" pour une derive ou un risque a surveiller.
- "good" pour une mesure stable ou rassurante.
- Integre la meteo quand elle change l'arrosage, la lumiere, la temperature, le vent ou l'evaporation.
- Si un signal bioelectrique est present, integre-le: une plante qui reagit a l'arrosage est rassurante; une activite faible/atone ou une chute de qualite merite un "watch".
- Ne mentionne pas OpenRouter, le cache ou le prompt.`;
}

async function generateInsightsWithOpenRouter(plant: PlantWithReadings, weather?: WeatherContext | null, bioText?: string): Promise<AiInsight[]> {
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
      model: resolveInsightsModel(),
      stream: false,
      ...samplingParams(resolveInsightsModel(), 0.25),
      max_tokens: 900,
      messages: [
        {
          role: "system",
          content: "Tu retournes uniquement du JSON valide, sans texte autour."
        },
        {
          role: "user",
          content: buildInsightsPrompt(plant, weather, bioText)
        }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter insights error: ${text}`);
  }

  const json = await response.json();
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("OpenRouter n'a pas retourne de contenu pour les insights");
  }

  try {
    return parseAiInsightsResponse(content);
  } catch (err) {
    throw new Error(`Reponse OpenRouter invalide: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function getCachedInsights(prisma: PrismaClient, plantId: string): Promise<AiInsight[]> {
  const cacheCutoff = new Date(Date.now() - INSIGHTS_CACHE_TTL_MS);
  const mem = await prisma.memory.findFirst({
    where: { plantId, kind: INSIGHTS_CACHE_KIND, createdAt: { gte: cacheCutoff } },
    orderBy: { createdAt: "desc" }
  });
  if (!mem) return [];
  try {
    const parsed = JSON.parse(mem.content) as Partial<InsightCachePayload>;
    return insightsPayloadSchema.parse({ insights: parsed.insights }).insights;
  } catch {
    return [];
  }
}

export async function getAiInsights(prisma: PrismaClient, plantId: string, weather?: WeatherContext | null): Promise<InsightResult> {
  const now = new Date();
  const cacheCutoff = new Date(now.getTime() - INSIGHTS_CACHE_TTL_MS);
  const weatherKey = buildWeatherCacheKey(weather);

  const cachedMemory = await prisma.memory.findFirst({
    where: {
      plantId,
      kind: INSIGHTS_CACHE_KIND,
      createdAt: { gte: cacheCutoff }
    },
    orderBy: { createdAt: "desc" }
  });

  if (cachedMemory) {
    const cached = parseCache(cachedMemory.content, weatherKey);
    if (cached && new Date(cached.expiresAt).getTime() > now.getTime()) {
      return {
        insights: cached.insights,
        cached: true,
        generatedAt: cached.generatedAt,
        expiresAt: cached.expiresAt,
        weatherIncluded: Boolean(weather)
      };
    }
  }

  const plant = await prisma.plant.findUniqueOrThrow({
    where: { id: plantId },
    include: {
      readings: { orderBy: { recordedAt: "desc" }, take: 24 }
    }
  });

  const bio = await summarizeBioForAgent(prisma, plantId);
  const insights = await generateInsightsWithOpenRouter(plant, weather, bio.hasDevice ? bio.text : undefined);
  const generatedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + INSIGHTS_CACHE_TTL_MS).toISOString();

  const memory = await prisma.memory.create({
    data: {
      plantId,
      kind: INSIGHTS_CACHE_KIND,
      content: JSON.stringify({
        version: 2,
        generatedAt,
        expiresAt,
        weatherKey,
        insights
      } satisfies InsightCachePayload)
    }
  });

  await prisma.memory.deleteMany({
    where: {
      plantId,
      kind: INSIGHTS_CACHE_KIND,
      id: { not: memory.id }
    }
  });

  return {
    insights,
    cached: false,
    generatedAt,
    expiresAt,
    weatherIncluded: Boolean(weather)
  };
}
