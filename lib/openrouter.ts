import type { ColorAnomalyReport } from "./ml/colorAnomaly";
import type { DiseaseReport } from "./ml/diseaseClassifier";
import { resolveAgentModel, resolveVisionModel, samplingParams, reasoningParams } from "./llm-models";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type PlantPhotoAnalysis = {
  summary: string;
  observations: string[];
  recommendations: string[];
  visualTags: string[];
  colorAnomalyScore: number;
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
      const visualTags = Array.isArray(parsed.visualTags) ? parsed.visualTags.map(String).slice(0, 12) : [];
      const colorAnomalyScore = clampNumber(parsed.colorAnomalyScore, 0, 1, 0);
      const score = parsed.healthScore == null ? null : Math.round(clampNumber(parsed.healthScore, 0, 100, 50));

      return {
        summary,
        observations,
        recommendations,
        visualTags,
        colorAnomalyScore,
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
    visualTags: [],
    colorAnomalyScore: 0,
    healthScore: null,
    confidence: 0.35
  };
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function colorObservation(report: ColorAnomalyReport) {
  if (!report.findings.length) return report.summary;
  const main = report.findings[0];
  return `Tags couleur locaux: ${report.tags.join(", ")}. Zone principale: ${main.label} (${main.position}, confiance ${Math.round(main.confidence * 100)}%).`;
}

function mergeColorReportIntoAnalysis(
  analysis: PlantPhotoAnalysis,
  report?: ColorAnomalyReport
): PlantPhotoAnalysis {
  if (!report) return analysis;

  const localObservation = report.findings.length ? colorObservation(report) : "";
  return {
    ...analysis,
    observations: uniqueStrings([
      ...(localObservation ? [localObservation] : []),
      ...analysis.observations
    ]).slice(0, 8),
    visualTags: uniqueStrings([...report.tags, ...analysis.visualTags]).slice(0, 12),
    colorAnomalyScore: Math.max(report.anomalyScore, analysis.colorAnomalyScore)
  };
}

function diseaseObservation(report: DiseaseReport): string {
  if (!report.available || !report.predictions.length) return "";
  const top = report.predictions[0];
  const others = report.predictions
    .slice(1, 3)
    .map((prediction) => `${prediction.label} ${Math.round(prediction.probability * 100)}%`)
    .join(", ");
  return (
    `Modele maladies (CNN): ${top.label} ${Math.round(top.probability * 100)}%` +
    (others ? ` (autres pistes: ${others})` : "") +
    `; probabilite globale de maladie ${Math.round(report.diseaseConfidence * 100)}%.`
  );
}

function mergeDiseaseReportIntoAnalysis(
  analysis: PlantPhotoAnalysis,
  report?: DiseaseReport
): PlantPhotoAnalysis {
  if (!report?.available || !report.predictions.length) return analysis;

  const observation = diseaseObservation(report);
  const top = report.predictions[0];
  // On promeut la prediction maladie en score d'anomalie quand le feuillage n'est pas sain.
  const diseaseAnomaly = top.healthy ? 0 : report.diseaseConfidence;
  return {
    ...analysis,
    observations: uniqueStrings([
      ...(observation ? [observation] : []),
      ...analysis.observations
    ]).slice(0, 8),
    colorAnomalyScore: Math.max(analysis.colorAnomalyScore, diseaseAnomaly)
  };
}

function formatDiseaseReportForPrompt(report?: DiseaseReport) {
  if (!report?.available || !report.predictions.length) return "";

  const lines = [
    "Pre-analyse modele maladies (classifieur CNN ONNX, PlantVillage):",
    `- probabilite_globale_maladie: ${report.diseaseConfidence.toFixed(2)}`
  ];
  for (const prediction of report.predictions.slice(0, 3)) {
    lines.push(
      `- ${prediction.label} (${prediction.raw}): ${prediction.probability.toFixed(2)}${prediction.healthy ? " [sain]" : ""}`
    );
  }
  lines.push(
    "Ces classes proviennent d'un dataset limite (PlantVillage) et peuvent ne pas correspondre a l'espece reelle. " +
    "Traite-les comme une hypothese a confirmer sur les images, pas comme un diagnostic certain."
  );
  return lines.join("\n");
}

function formatColorReportForPrompt(report?: ColorAnomalyReport) {
  if (!report) return "";

  const lines = [
    "Pre-analyse ML locale des couleurs:",
    `- score_anomalie_couleur: ${report.anomalyScore.toFixed(2)}; couverture_estimee: ${report.coveragePct.toFixed(2)}%; confiance: ${report.confidence.toFixed(2)}`,
    `- tags_detectes: ${report.tags.length ? report.tags.join(", ") : "aucun"}`
  ];

  for (const finding of report.findings.slice(0, 8)) {
    lines.push(
      `- ${finding.view ? `${finding.view}: ` : ""}${finding.tag} (${finding.label}) position=${finding.position}, couverture=${finding.coveragePct.toFixed(2)}%, confiance=${finding.confidence.toFixed(2)}`
    );
  }

  lines.push("Utilise ces tags comme indices visuels, verifie-les sur les images, corrige-les si necessaire et renvoie les tags pertinents dans visualTags.");
  return lines.join("\n");
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
      model: resolveAgentModel(),
      stream: true,
      ...samplingParams(resolveAgentModel(), 0.45),
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
  imageDataUrl?: string;
  imageDataUrls?: string[];
  plantContext: string;
  title?: string;
  colorAnomalyReport?: ColorAnomalyReport;
  diseaseReport?: DiseaseReport;
}): Promise<PlantPhotoAnalysis> {
  const imageDataUrls = input.imageDataUrls?.length
    ? input.imageDataUrls
    : input.imageDataUrl
      ? [input.imageDataUrl]
      : [];

  if (!imageDataUrls.length) {
    throw new Error("Aucune image fournie pour l'analyse.");
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    const diseaseHint = input.diseaseReport?.available ? ` ${input.diseaseReport.summary}` : "";
    return mergeDiseaseReportIntoAnalysis(
      mergeColorReportIntoAnalysis({
        summary: input.colorAnomalyReport?.findings.length
          ? `Analyse IA indisponible: OPENROUTER_API_KEY n'est pas configure. ${input.colorAnomalyReport.summary}${diseaseHint}`
          : `Analyse IA indisponible: OPENROUTER_API_KEY n'est pas configure.${diseaseHint}`,
        observations: input.colorAnomalyReport?.findings.length ? [colorObservation(input.colorAnomalyReport)] : [],
        recommendations: ["Configurer OPENROUTER_API_KEY pour activer l'analyse photo par OpenRouter."],
        visualTags: input.colorAnomalyReport?.tags ?? [],
        colorAnomalyScore: input.colorAnomalyReport?.anomalyScore ?? 0,
        healthScore: null,
        confidence: 0
      }, input.colorAnomalyReport),
      input.diseaseReport
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
      model: resolveVisionModel(),
      stream: false,
      ...samplingParams(resolveVisionModel(), 0.2),
      ...reasoningParams(),
      max_tokens: 1600,
      messages: [
        {
          role: "system",
          content:
            "Tu es un expert horticole qui analyse des photos de plantes. Reponds uniquement avec un JSON valide: " +
            "{\"summary\":\"...\",\"observations\":[\"...\"],\"recommendations\":[\"...\"],\"visualTags\":[\"tache-jaune\"],\"colorAnomalyScore\":0-1,\"healthScore\":0-100|null,\"confidence\":0-1}. " +
            "Quand plusieurs vues sont fournies, recoupe-les avant de conclure. Ne diagnostique pas une maladie avec certitude depuis les images seules; indique les incertitudes."
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                `Titre analyse: ${input.title || "photo plante"}\n` +
                `Nombre de vues: ${imageDataUrls.length}\n` +
                `${input.plantContext}\n\n` +
                `${formatColorReportForPrompt(input.colorAnomalyReport)}\n\n` +
                `${formatDiseaseReportForPrompt(input.diseaseReport)}\n\n` +
                "Analyse les signes visibles sur toutes les vues: feuilles, couleur, taches, port, substrat visible, stress hydrique/lumiere, coherence entre angles, et donne des actions concretes."
            },
            ...imageDataUrls.flatMap((imageDataUrl, index) => [
              {
                type: "text",
                text: `Vue ${index + 1}/${imageDataUrls.length}`
              },
              {
                type: "image_url",
                image_url: { url: imageDataUrl }
              }
            ])
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
  return mergeDiseaseReportIntoAnalysis(
    mergeColorReportIntoAnalysis(
      parsePhotoAnalysis(typeof content === "string" ? content : JSON.stringify(content ?? "")),
      input.colorAnomalyReport
    ),
    input.diseaseReport
  );
}
