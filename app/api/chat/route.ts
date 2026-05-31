import { prisma } from "@/lib/prisma";
import { runAgenticLoop, buildStreamingResponse } from "@/lib/agentic/orchestrator";
import { compactConversation } from "@/lib/agentic/memory";
import { chatSchema } from "@/lib/schemas";
import { getWeatherContext } from "@/lib/weather";

export const runtime = "nodejs";

// GET /api/chat?plantId=... -> historique du fil pour hydrater l'UI au chargement.
export async function GET(request: Request) {
  const plantId = new URL(request.url).searchParams.get("plantId");
  if (!plantId) {
    return Response.json({ error: "plantId requis" }, { status: 400 });
  }

  const messages = await prisma.chatMessage.findMany({
    where: { plantId },
    orderBy: { createdAt: "asc" },
    take: 60
  });

  return Response.json({
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString()
    }))
  });
}

export async function POST(request: Request) {
  const { plantId, message, webSearch, weatherLocation, timezone } = chatSchema.parse(await request.json());

  const plant = await prisma.plant.findUniqueOrThrow({ where: { id: plantId } });
  const now = new Date();
  const from = new Date(now.getTime() - 14 * 86400000);
  const to = new Date(now.getTime() + 45 * 86400000);
  const [latestReadings, openAlerts, memories, chatHistory, recentPhotos, calendarEvents] = await Promise.all([
    prisma.reading.findMany({ where: { plantId }, orderBy: { recordedAt: "desc" }, take: 16 }),
    prisma.alert.findMany({ where: { plantId, status: "open" }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.memory.findMany({ where: { plantId }, orderBy: { createdAt: "desc" }, take: 15 }),
    prisma.chatMessage.findMany({ where: { plantId }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.plantPhoto.findMany({ where: { plantId }, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.calendarEvent.findMany({
      where: { plantId, startsAt: { gte: from, lte: to } },
      orderBy: { startsAt: "asc" },
      take: 40
    })
  ]);

  const userMessage = await prisma.chatMessage.create({ data: { plantId, role: "user", content: message } });

  const encoder = new TextEncoder();

  // Start the stream immediately so Cloudflare receives HTTP headers right away
  // and does not 524-timeout while waiting for the agentic loop to complete.
  const stream = new ReadableStream({
    async start(controller) {
      const send = (text: string) => { try { controller.enqueue(encoder.encode(text)); } catch { /* client disconnected */ } };

      // Send an initial newline so the TCP connection is fully established and
      // Cloudflare's read-timeout clock resets before the slow AI calls begin.
      send("\n");

      // Periodic keepalive to prevent proxy idle-timeout during long AI calls
      // (Railway/Cloudflare can cut connections after ~100s of silence).
      const keepalive = setInterval(() => {
        try { send(" "); } catch { /* stream already closed */ }
      }, 20000);

      try {
        const weather = await getWeatherContext({
          location: weatherLocation || plant.location || undefined,
          timezone
        }).catch(() => null);

        const result = await runAgenticLoop(prisma, {
          plant,
          latestReadings,
          openAlerts,
          memories,
          chatHistory: [userMessage, ...chatHistory],
          weather,
          recentPhotos,
          calendarEvents
        }, { webSearch: webSearch ?? true });

        const responseText = buildStreamingResponse(result);

        await prisma.chatMessage.create({
          data: { plantId, role: "assistant", content: responseText.slice(0, 2000) }
        });

        send(responseText);

        // Auto-compaction du fil de conversation (best-effort, ne bloque pas la reponse).
        try {
          const allMessages = await prisma.chatMessage.findMany({
            where: { plantId },
            orderBy: { createdAt: "desc" },
            take: 60
          });
          const compacted = await compactConversation(plant, allMessages);
          if (compacted) {
            await prisma.plant.update({
              where: { id: plantId },
              data: {
                conversationSummary: compacted.conversationSummary,
                lastCompactedAt: compacted.lastCompactedAt
              }
            });
          }
        } catch { /* compaction best-effort */ }
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Erreur inconnue de l'agent";
        // Don't persist stream/connection errors — they happen when the client disconnects
        const isStreamError = msg.toLowerCase().includes("controller") || msg.toLowerCase().includes("closed");

        if (!isStreamError) {
          await prisma.chatMessage.create({
            data: { plantId, role: "assistant", content: `Erreur: ${msg}` }
          }).catch(() => {});
          send(`Erreur agentique: ${msg}`);
        }
      } finally {
        clearInterval(keepalive);
        try { controller.close(); } catch { /* already closed by client disconnect */ }
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache"
    }
  });
}
