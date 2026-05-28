import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { plantUpdateSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export async function GET() {
  const plants = await prisma.plant.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      device: true,
      alerts: { where: { status: "open" }, orderBy: { createdAt: "desc" }, take: 10 },
      readings: { orderBy: { recordedAt: "desc" }, take: 40 }
    }
  });

  const sorted = plants.sort((left, right) => {
    const leftTime = left.readings[0]?.recordedAt?.getTime() ?? left.updatedAt.getTime();
    const rightTime = right.readings[0]?.recordedAt?.getTime() ?? right.updatedAt.getTime();
    return rightTime - leftTime;
  });

  return NextResponse.json({ plants: sorted });
}

export async function POST(request: NextRequest) {
  const body = plantUpdateSchema.parse(await request.json());
  const { id, ...data } = body;
  const existing = id
    ? await prisma.plant.findUnique({ where: { id } })
    : await prisma.plant.findFirst({ orderBy: { updatedAt: "desc" } });

  const plant = existing
    ? await prisma.plant.update({ where: { id: existing.id }, data })
    : await prisma.plant.create({ data });

  return NextResponse.json({ plant });
}
