import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPlantPhotoObject } from "@/lib/photo-storage";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id photo requis" }, { status: 400 });
  }

  const photo = await prisma.plantPhoto.findUnique({ where: { id } });
  if (!photo) {
    return NextResponse.json({ error: "Photo introuvable" }, { status: 404 });
  }

  const object = await getPlantPhotoObject(photo.objectKey);
  const body = new Blob([object.bytes as BlobPart], { type: object.mimeType });
  return new Response(body, {
    headers: {
      "Content-Type": object.mimeType,
      "Cache-Control": object.cacheControl
    }
  });
}
