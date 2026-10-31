import { z } from "zod";
import { getAuthSession } from "@/lib/auth-session";
import { getPrisma } from "@/lib/prisma";
import { pushEndpointSchema, pushSubscriptionSchema } from "@/domain/task-push";
import { readTaskPushStatus, retryFailedTaskPush, revokeTaskPushSubscription, saveTaskPushSubscription, TaskPushError } from "@/lib/task-push";

const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("subscribe"), subscription: pushSubscriptionSchema }),
  pushEndpointSchema.extend({ action: z.literal("revoke") }),
  pushEndpointSchema.extend({ action: z.literal("status") }),
  z.object({ action: z.literal("retry") }),
]);
const headers = { "Cache-Control": "private, no-store" };
export async function GET() {
  const session = await getAuthSession();
  if (!session?.user.twoFactorEnabled) return Response.json({ error: "No autorizado" }, { status: 401, headers });
  return Response.json(await readTaskPushStatus(getPrisma(), session.user.id), { headers });
}
export async function POST(request: Request) {
  const session = await getAuthSession();
  if (!session?.user.twoFactorEnabled) return Response.json({ error: "No autorizado" }, { status: 401, headers });
  const origin = process.env.BETTER_AUTH_URL ? new URL(process.env.BETTER_AUTH_URL).origin : new URL(request.url).origin;
  if (request.headers.get("origin") !== origin) return Response.json({ error: "Origen no autorizado" }, { status: 403, headers });
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return Response.json({ error: "Revisa los datos" }, { status: 415, headers });
  const body = await request.text();
  if (body.length > 8192) return Response.json({ error: "Revisa los datos" }, { status: 413, headers });
  let raw: unknown;
  try { raw = JSON.parse(body); }
  catch { return Response.json({ error: "Revisa los datos" }, { status: 400, headers }); }
  try {
    const input = commandSchema.parse(raw), userId = session.user.id, db = getPrisma();
    if (input.action === "subscribe") await saveTaskPushSubscription(db, userId, input.subscription);
    if (input.action === "revoke") await revokeTaskPushSubscription(db, userId, input);
    if (input.action === "retry") await retryFailedTaskPush(db, userId);
    const endpoint = input.action === "subscribe" ? input.subscription.endpoint : input.action === "retry" ? undefined : input.endpoint;
    return Response.json(await readTaskPushStatus(db, userId, endpoint), { headers });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof TaskPushError)
      return Response.json({ error: error instanceof TaskPushError ? error.message : "La suscripción push no es válida" }, { status: 400, headers });
    console.error("Task push subscription operation failed");
    throw error;
  }
}
