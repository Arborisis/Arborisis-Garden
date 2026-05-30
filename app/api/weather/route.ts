import { NextRequest, NextResponse } from "next/server";
import { weatherQuerySchema } from "@/lib/schemas";
import { getWeatherContext } from "@/lib/weather";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const start = Date.now();
  try {
    const query = Object.fromEntries(request.nextUrl.searchParams.entries());
    const params = weatherQuerySchema.parse(query);
    const weather = await getWeatherContext(params);
    console.log(JSON.stringify({ route: "GET /api/weather", location: params.location, latencyMs: Date.now() - start, status: 200 }));
    return NextResponse.json({ weather });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Meteo indisponible";
    console.log(JSON.stringify({ route: "GET /api/weather", error: message, latencyMs: Date.now() - start, status: 502 }));
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
