"use server";
import { requireOwnerId } from "@/lib/require-owner";
import { getPrisma } from "@/lib/prisma";
import { syncGoogleCalendar } from "@/lib/google-calendar";
import { TaskManagementError } from "@/lib/task-management";
import { refreshTaskSurfaces, type TaskActionResult } from "./manage-actions";

export async function synchronizeGoogle(resolution?: "local" | "remote"): Promise<TaskActionResult> {
  const userId = await requireOwnerId();
  if (resolution !== undefined && resolution !== "local" && resolution !== "remote") throw new Error("Invalid Google conflict resolution");
  try {
    await syncGoogleCalendar(userId, resolution);
    await refreshTaskSurfaces(); return { saved: true };
  } catch (error) {
    console.error("Google Calendar synchronization failed", error instanceof Error ? error.message : "Unknown Google error");
    await refreshTaskSurfaces();
    return { error: error instanceof TaskManagementError ? error.message : "No se pudo sincronizar Google Calendar" };
  }
}
export async function disconnectGoogle(): Promise<TaskActionResult> {
  const userId = await requireOwnerId();
  // Keep the account/calendar binding and event mappings so reconnecting cannot duplicate events.
  await getPrisma().googleCalendarConnection.updateMany({ where: { userId }, data: { refreshToken: "", error: null, lockedUntil: null } });
  await refreshTaskSurfaces(); return { saved: true };
}
