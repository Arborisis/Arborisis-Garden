import type { PrismaClient, Memory } from "@prisma/client";
import type { AgentMemoryUpdate } from "./types";

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
