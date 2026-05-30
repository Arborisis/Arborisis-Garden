import { prisma } from "@/lib/prisma";
import { runAgenticLoop, buildStreamingResponse } from "@/lib/agentic/orchestrator";
import { chatSchema } from "@/lib/schemas";
import { getWeatherContext } from "@/lib/weather";

export const runtime = "nodejs";

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
    prisma.chatMessage.findMany({ where: { plantId }, orderBy: { createdAt: "desc" }, take: 8 }),
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
      const send = (text: string) => controller.enqueue(encoder.encode(text));

      // Send an initial newline so the TCP connection is fully established and
      // Cloudflare's read-timeout clock resets before the slow AI calls begin.
      send("\n");

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
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Erreur inconnue de l'agent";

        await prisma.chatMessage.create({
          data: { plantId, role: "assistant", content: `Erreur: ${msg}` }
        }).catch(() => {});

        send(`Erreur agentique: ${msg}`);
      } finally {
        controller.close();
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
