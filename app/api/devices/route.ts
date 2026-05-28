import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const devices = await prisma.device.findMany({
    orderBy: { updatedAt: "desc" },
    include: { plants: true }
  });

  return NextResponse.json({
    devices,
    ingestUrl: "/api/telemetry",
    tokenRequired: Boolean(process.env.DEVICE_INGEST_TOKEN)
  });
}
