import { getPrisma } from "@/lib/prisma";
import { getAuthSession } from "@/lib/auth-session";
import { readDueTaskReminders } from "@/lib/task-reminders";
export async function GET() {
  const session = await getAuthSession();
  if (!session || !session.user.twoFactorEnabled) return Response.json({ error: "No autorizado" }, { status: 401 });
  const reminders = await readDueTaskReminders(getPrisma(), session.user.id);
  return Response.json(reminders, { headers: { "Cache-Control": "private, no-store" } });
}
