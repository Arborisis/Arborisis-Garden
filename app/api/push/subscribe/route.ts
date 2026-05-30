import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const runtime = "nodejs";

const schema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string()
  })
});

export async function POST(request: Request) {
  const start = Date.now();
  try {
    const body = schema.parse(await request.json());
    const userAgent = request.headers.get("user-agent") ?? undefined;

    await prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      update: { p256dh: body.keys.p256dh, auth: body.keys.auth, userAgent },
      create: {
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        userAgent
      }
    });
    console.log(JSON.stringify({ route: "POST /api/push/subscribe", latencyMs: Date.now() - start, status: 200 }));
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Invalid subscription" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const start = Date.now();
  try {
    const { endpoint } = z.object({ endpoint: z.string() }).parse(await request.json());
    await prisma.pushSubscription.deleteMany({ where: { endpoint } });
    console.log(JSON.stringify({ route: "DELETE /api/push/subscribe", latencyMs: Date.now() - start, status: 200 }));
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
}
