import type { PrismaClient, Memory, ChatMessage, Plant } from "@prisma/client";
import type { AgentMemoryUpdate } from "./types";
import { callOpenRouter } from "./llm";

// Tours de conversation gardes verbatim avant compaction.
export const CONVERSATION_KEEP_WINDOW = 12;
// Nb minimal de messages anciens (hors fenetre, non compactes) pour declencher une compaction.
const COMPACTION_TRIGGER = 8;
const SUMMARY_MAX_CHARS = 1500;

export async function persistMemories(
  prisma: PrismaClient,
  plantId: string,
  updates: AgentMemoryUpdate[]
): Promise<Memory[]> {
  const created: Memory[] = [];
  for (const update of updates) {
    const memory = await prisma.memory.create({
      data: {
        plantId,
        kind: update.kind,
        content: update.content.slice(0, 900)
      }
    });
    created.push(memory);
  }
  return created;
}

export async function updateMemorySummary(
  prisma: PrismaClient,
  plantId: string,
  currentSummary: string,
  newMemories: AgentMemoryUpdate[]
): Promise<string | null> {
  const important = newMemories.filter((m) => m.importance >= 0.6);
  if (important.length === 0) return null;

  const timestamp = new Date().toISOString().slice(0, 10);
  const additions = important.map((m) => `[${timestamp}] ${m.kind}: ${m.content}`).join(" | ");

  const maxLen = 800;
  const base = currentSummary || "";
  const combined = base ? `${base} | ${additions}` : additions;
  return combined.length > maxLen ? combined.slice(-maxLen) : combined;
}

export type CompactionResult = {
  conversationSummary: string;
  lastCompactedAt: Date;
} | null;

/**
 * Auto-compaction du fil de conversation: quand l'historique non compacte (hors
 * fenetre recente) depasse un seuil, on resume les anciens tours via le LLM et on
 * fusionne dans `plant.conversationSummary`, en avancant le curseur `lastCompactedAt`.
 * Les messages restent en DB (pour le fil UI); seul le contexte envoye au modele est reduit.
 */
export async function compactConversation(
  plant: Pick<Plant, "conversationSummary" | "lastCompactedAt">,
  allMessages: ChatMessage[]
): Promise<CompactionResult> {
  // Ordre chronologique croissant.
  const ordered = [...allMessages].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const cursor = plant.lastCompactedAt ? new Date(plant.lastCompactedAt).getTime() : 0;
  const uncompacted = ordered.filter((m) => new Date(m.createdAt).getTime() > cursor);

  // On garde la fenetre recente verbatim; on ne compacte que ce qui depasse.
  const toCompact = uncompacted.slice(0, Math.max(0, uncompacted.length - CONVERSATION_KEEP_WINDOW));
  if (toCompact.length < COMPACTION_TRIGGER) return null;

  const transcript = toCompact
    .map((m) => `${m.role === "user" ? "Utilisateur" : "Arborisis"}: ${m.content.slice(0, 400)}`)
    .join("\n");

  const previous = plant.conversationSummary?.trim();
  const prompt = [
    "Tu maintiens la memoire longue d'un agent horticole. Resume la conversation suivante",
    "en puces concises et durables (preferences de l'utilisateur, faits sur la plante, decisions",
    "prises, etat de suivi). Fusionne avec le resume existant sans repeter, garde le plus utile,",
    `et reste sous ${SUMMARY_MAX_CHARS} caracteres. Reponds uniquement avec les puces, en francais.`,
    previous ? `\n=== RESUME EXISTANT ===\n${previous}` : "",
    `\n=== NOUVEAUX ECHANGES A INTEGRER ===\n${transcript}`
  ].join("\n");

  let summary: string;
  try {
    const result = await callOpenRouter(
      [{ role: "user", content: prompt }],
      { temperature: 0.2 }
    );
    summary = result.content.trim();
  } catch {
    // En cas d'echec LLM, on ne bloque pas la conversation: on conserve l'existant.
    return null;
  }

  if (!summary) return null;

  const lastCompacted = toCompact[toCompact.length - 1];
  return {
    conversationSummary: summary.slice(0, SUMMARY_MAX_CHARS),
    lastCompactedAt: new Date(lastCompacted.createdAt)
  };
}

export async function closeResolvedAlerts(
  prisma: PrismaClient,
  plantId: string,
  alertTitles: string[]
): Promise<Memory[]> {
  if (alertTitles.length === 0) return [];

  const closed: Memory[] = [];
  for (const title of alertTitles) {
    const alerts = await prisma.alert.findMany({
      where: { plantId, status: "open", title }
    });
    for (const alert of alerts) {
      await prisma.alert.update({
        where: { id: alert.id },
        data: { status: "closed" }
      });
      const memory = await prisma.memory.create({
        data: {
          plantId,
          kind: "reflection",
          content: `Alerte resolue: [${alert.severity}] ${alert.title}`
        }
      });
      closed.push(memory);
    }
  }
  return closed;
}
