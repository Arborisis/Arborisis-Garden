import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { plantCalibrationSchema } from "@/lib/schemas";
import {
  buildCalibrationResearchPrompt,
  buildSensorCalibration,
  parseProfileCalibration,
  type PlantProfileCalibration
} from "@/lib/calibration";
import { resolveAgentModel, samplingParams, reasoningParams } from "@/lib/llm-models";

export const runtime = "nodejs";

type OpenRouterAnnotation = {
  type?: string;
  url_citation?: {
    url?: string;
    title?: string;
  };
};

function readNumberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function buildOpenRouterWebTool() {
  return {
    type: "openrouter:web_search",
    parameters: {
      engine: process.env.OPENROUTER_WEB_SEARCH_ENGINE ?? "auto",
      max_results: readNumberEnv("OPENROUTER_CALIBRATION_WEB_SEARCH_MAX_RESULTS", 8),
      max_total_results: readNumberEnv("OPENROUTER_CALIBRATION_WEB_SEARCH_MAX_TOTAL_RESULTS", 20),
      search_context_size: "high"
    }
  };
}

function mergeSources(profile: PlantProfileCalibration, annotations: OpenRouterAnnotation[]) {
  const seen = new Set<string>();
  const sources = [
    ...profile.sources,
    ...annotations
      .filter((annotation) => annotation.type === "url_citation" && annotation.url_citation?.url)
      .map((annotation) => ({
        title: annotation.url_citation?.title || annotation.url_citation?.url || "Source web",
        url: annotation.url_citation?.url || ""
      }))
  ];

  return sources.filter((source) => {
    if (!source.url || seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  }).slice(0, 8);
}

async function researchPlantProfile(prompt: string): Promise<PlantProfileCalibration> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY manquant: l'auto-calibrage LLM avec recherche web est indisponible.");
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
      model: resolveAgentModel(),
      stream: false,
      ...samplingParams(resolveAgentModel(), 0.15),
      ...reasoningParams(),
      max_tokens: 2200,
      tools: [buildOpenRouterWebTool()],
      messages: [
        {
          role: "system",
          content: "Tu calibres des profils de plantes uniquement apres recherche web. Tu retournes du JSON strict."
        },
        { role: "user", content: prompt }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter calibration error: ${text}`);
  }

  const json = await response.json();
  const message = json.choices?.[0]?.message;
  const profile = parseProfileCalibration(message?.content ?? "");
  profile.sources = mergeSources(profile, message?.annotations ?? []);
  return profile;
}

export async function POST(request: NextRequest) {
  try {
    const body = plantCalibrationSchema.parse(await request.json().catch(() => ({})));
    const plant = body.plantId
      ? await prisma.plant.findUniqueOrThrow({ where: { id: body.plantId } })
      : await prisma.plant.findFirstOrThrow({ orderBy: { updatedAt: "desc" } });

    const readings = await prisma.reading.findMany({
      where: { plantId: plant.id },
      orderBy: { recordedAt: "desc" },
      take: 80
    });
    const profile = await researchPlantProfile(buildCalibrationResearchPrompt(plant, readings));
    const sensor = buildSensorCalibration(plant, readings);
    const calibration = { profile, sensor };

    const updatedPlant = await prisma.plant.update({
      where: { id: plant.id },
      data: {
        targetMoisture: calibration.profile.targetMoisture,
        minLightLux: calibration.profile.minLightLux,
        minSoilTempC: calibration.profile.minSoilTempC,
        maxSoilTempC: calibration.profile.maxSoilTempC,
        moistureDryRaw: calibration.sensor.moistureDryRaw,
        moistureWetRaw: calibration.sensor.moistureWetRaw
      }
    });

    await prisma.memory.create({
      data: {
        plantId: plant.id,
        kind: "reflection",
        content: [
          `Auto-calibrage LLM web: ${calibration.profile.researchedName}`,
          `humidite cible ${calibration.profile.targetMoisture}%`,
          `lumiere min ${calibration.profile.minLightLux} lx`,
          calibration.sensor.appliedFromHistory
            ? `capteur humidite ${calibration.sensor.moistureDryRaw}/${calibration.sensor.moistureWetRaw}`
            : "capteur humidite conserve faute d'historique brut fiable"
        ].join(", ")
      }
    });

    return NextResponse.json({ plant: updatedPlant, calibration });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auto-calibrage indisponible";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
