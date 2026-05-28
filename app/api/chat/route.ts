import { prisma } from "@/lib/prisma";
import { runAgenticLoop, buildStreamingResponse } from "@/lib/agentic/orchestrator";
import { chatSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { plantId, message } = chatSchema.parse(await request.json());

  const plant = await prisma.plant.findUniqueOrThrow({ where: { id: plantId } });
  const [latestReadings, openAlerts, memories, chatHistory] = await Promise.all([
    prisma.reading.findMany({ where: { plantId }, orderBy: { recordedAt: "desc" }, take: 16 }),
    prisma.alert.findMany({ where: { plantId, status: "open" }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.memory.findMany({ where: { plantId }, orderBy: { createdAt: "desc" }, take: 15 }),
    prisma.chatMessage.findMany({ where: { plantId }, orderBy: { createdAt: "desc" }, take: 8 })
  ]);

  await prisma.chatMessage.create({ data: { plantId, role: "user", content: message } });

  try {
    const result = await runAgenticLoop(prisma, {
      plant,
      latestReadings,
      openAlerts,
      memories,
      chatHistory
    });

    const responseText = buildStreamingResponse(result);

    // Persist assistant response
    await prisma.chatMessage.create({
      data: { plantId, role: "assistant", content: responseText.slice(0, 2000) }
    });

    // Stream the response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const chunks = responseText.split("");
        let index = 0;

        function push() {
          if (index >= chunks.length) {
            controller.close();
            return;
          }
          const chunk = chunks[index++];
          controller.enqueue(encoder.encode(chunk));
          setTimeout(push, 2); // Simulate streaming
        }

        push();
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue de l'agent";

    await prisma.chatMessage.create({
      data: { plantId, role: "assistant", content: `Erreur: ${message}` }
    });

    return new Response(`Erreur agentique: ${message}`, {
      status: 502,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}
