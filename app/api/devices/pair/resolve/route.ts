import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

export const runtime = "nodejs";

const GENERIC_ERROR = "Invalid or expired pairing code";

function getIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export async function POST(req: NextRequest) {
  const start = Date.now();
  const ip = getIp(req);

  try {
    const body = (await req.json()) as { code?: string; deviceSerial?: string };
    const { code, deviceSerial } = body ?? {};

    if (!code || typeof code !== "string" || !deviceSerial || typeof deviceSerial !== "string") {
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 });
    }

    const allowed = checkRateLimit(ip, "pair-resolve", 5, 60_000);
    if (!allowed) {
      console.log(JSON.stringify({ route: "POST /api/devices/pair/resolve", ip, event: "rate_limited", latencyMs: Date.now() - start, status: 429 }));
      return NextResponse.json({ error: "Too many attempts, try again later" }, { status: 429 });
    }

    const record = await prisma.pairingCode.findUnique({ where: { code } });

    if (!record || record.usedAt !== null || record.expiresAt < new Date()) {
      console.log(JSON.stringify({ route: "POST /api/devices/pair/resolve", ip, event: "invalid_code", latencyMs: Date.now() - start, status: 400 }));
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 });
    }

    const token = randomBytes(32).toString("hex");
    const tokenHash = await bcrypt.hash(token, 10);

    const device = await prisma.device.findUnique({ where: { serial: deviceSerial } });
    if (!device) {
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 });
    }

    await prisma.$transaction([
      prisma.device.update({ where: { serial: deviceSerial }, data: { tokenHash } }),
      prisma.pairingCode.update({ where: { code }, data: { usedAt: new Date() } }),
    ]);

    console.log(JSON.stringify({ route: "POST /api/devices/pair/resolve", deviceSerial, latencyMs: Date.now() - start, status: 200 }));
    return NextResponse.json({ ok: true, token });
  } catch (err) {
    console.log(JSON.stringify({ route: "POST /api/devices/pair/resolve", error: String(err), latencyMs: Date.now() - start, status: 500 }));
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
