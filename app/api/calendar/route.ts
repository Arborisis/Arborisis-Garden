import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  calendarEventCreateSchema,
  calendarEventDeleteSchema,
  calendarEventQuerySchema,
  calendarEventUpdateSchema
} from "@/lib/schemas";

export const runtime = "nodejs";

function serializeEvent(event: {
  id: string;
  plantId: string;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date | null;
  category: string;
  priority: string;
  status: string;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...event,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt?.toISOString() ?? null,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString()
  };
}

export async function GET(request: NextRequest) {
  const start = Date.now();
  const query = calendarEventQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  const now = new Date();
  const from = new Date(now.getTime() - 14 * 86400000);
  const to = new Date(now.getTime() + 45 * 86400000);

  const events = await prisma.calendarEvent.findMany({
    where: {
      plantId: query.plantId,
      startsAt: { gte: from, lte: to }
    },
    orderBy: { startsAt: "asc" },
    take: 80
  });
  console.log(JSON.stringify({ route: "GET /api/calendar", plantId: query.plantId, count: events.length, latencyMs: Date.now() - start, status: 200 }));
  return NextResponse.json({ events: events.map(serializeEvent) });
}

export async function POST(request: NextRequest) {
  const start = Date.now();
  const body = calendarEventCreateSchema.parse(await request.json());
  const event = await prisma.calendarEvent.create({
    data: {
      plantId: body.plantId,
      title: body.title,
      description: body.description ?? null,
      startsAt: new Date(body.startsAt),
      endsAt: body.endsAt ? new Date(body.endsAt) : null,
      category: body.category,
      priority: body.priority,
      status: body.status,
      source: body.source
    }
  });
  console.log(JSON.stringify({ route: "POST /api/calendar", plantId: body.plantId, eventId: event.id, latencyMs: Date.now() - start, status: 200 }));
  return NextResponse.json({ event: serializeEvent(event) });
}

export async function PATCH(request: NextRequest) {
  const body = calendarEventUpdateSchema.parse(await request.json());
  const { id, plantId: _plantId, startsAt, endsAt, ...rest } = body;
  const event = await prisma.calendarEvent.update({
    where: { id },
    data: {
      ...rest,
      startsAt: startsAt ? new Date(startsAt) : undefined,
      endsAt: endsAt ? new Date(endsAt) : endsAt === null ? null : undefined
    }
  });

  return NextResponse.json({ event: serializeEvent(event) });
}

export async function DELETE(request: NextRequest) {
  const body = calendarEventDeleteSchema.parse(await request.json());
  await prisma.calendarEvent.delete({ where: { id: body.id } });
  return NextResponse.json({ ok: true });
}
