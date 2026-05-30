import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAiInsights } from "@/lib/insights";
import { insightsQuerySchema } from "@/lib/schemas";
import { getWeatherContext } from "@/lib/weather";
import { ZodError } from "zod";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const start = Date.now();
  try {
    const query = insightsQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    const plant = await prisma.plant.findUniqueOrThrow({ where: { id: query.plantId } });
    const weather = await getWeatherContext({
      location: query.weatherLocation || plant.location || undefined,
      timezone: query.timezone
    }).catch(() => null);

    const result = await getAiInsights(prisma, query.plantId, weather);
    console.log(JSON.stringify({ route: "GET /api/insights", plantId: query.plantId, cached: result.cached, latencyMs: Date.now() - start, status: 200 }));
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "private, max-age=60"
      }
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Parametres insights invalides" }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Generation insights impossible";
    console.log(JSON.stringify({ route: "GET /api/insights", error: message, latencyMs: Date.now() - start, status: 502 }));
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
