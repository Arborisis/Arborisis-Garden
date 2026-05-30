import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { randomBytes } from "node:crypto";

export const runtime = "nodejs";

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;
const EXPIRY_MS = 15 * 60 * 1000;

function generateCode(): string {
  const bytes = randomBytes(CODE_LEN);
  return Array.from(bytes, (b) => CHARS[b % CHARS.length]).join("");
}

export async function POST(req: Request) {
  const start = Date.now();
  try {
    const body = (await req.json()) as { deviceSerial?: string };
    const deviceSerial = body?.deviceSerial;
    if (!deviceSerial || typeof deviceSerial !== "string") {
      return NextResponse.json({ error: "deviceSerial required" }, { status: 400 });
    }

    let code: string;
    let attempts = 0;
    do {
      code = generateCode();
      attempts++;
      if (attempts > 10) {
        return NextResponse.json({ error: "Could not generate unique code" }, { status: 500 });
      }
    } while (await prisma.pairingCode.findUnique({ where: { code } }));

    const expiresAt = new Date(Date.now() + EXPIRY_MS);
    await prisma.pairingCode.create({ data: { code, deviceSerial, expiresAt } });

    console.log(JSON.stringify({ route: "POST /api/devices/pair", deviceSerial, latencyMs: Date.now() - start, status: 201 }));
    return NextResponse.json({ code, expiresAt }, { status: 201 });
  } catch (err) {
    console.log(JSON.stringify({ route: "POST /api/devices/pair", error: String(err), latencyMs: Date.now() - start, status: 500 }));
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
