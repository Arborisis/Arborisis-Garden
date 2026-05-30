import { prisma } from "@/lib/prisma";

export type PushPayload = {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  urgency?: "low" | "normal" | "high" | "very-low";
  data?: Record<string, unknown>;
};

function getWebpush() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const webpush = require("web-push") as typeof import("web-push");
  webpush.setVapidDetails(
    "mailto:garden@arborisis.app",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
  return webpush;
}

export async function sendPushToAll(payload: PushPayload): Promise<{ sent: number; failed: number }> {
  const webpush = getWebpush();
  const subs = await prisma.pushSubscription.findMany();
  let sent = 0;
  let failed = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ icon: "/icon.svg", badge: "/icon.svg", ...payload }),
          { urgency: payload.urgency ?? "normal", TTL: 3600 }
        );
        sent++;
      } catch (err: unknown) {
        failed++;
        // Remove expired/invalid subscriptions (410 Gone or 404 Not Found)
        if (err && typeof err === "object" && "statusCode" in err &&
            (err.statusCode === 410 || err.statusCode === 404)) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => null);
        }
      }
    })
  );

  return { sent, failed };
}
