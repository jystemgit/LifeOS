import { requireOwnerId } from "@/lib/require-owner";
import { getPrisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireOwnerId();
  const { id } = await params;
  const attachment = await getPrisma().taskAttachment.findFirst({ where: { id, userId, task: { deletedAt: null } } });
  if (!attachment) return new Response("Archivo no disponible", { status: 404 });
  return new Response(new Uint8Array(attachment.content), { headers: {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  } });
}
