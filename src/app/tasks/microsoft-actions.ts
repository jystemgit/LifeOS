"use server";
import { requireOwnerId } from "@/lib/require-owner";
import { syncMicrosoft } from "@/lib/microsoft-todo";
import { TaskManagementError } from "@/lib/task-management";
import { getPrisma } from "@/lib/prisma";
import { refreshTaskSurfaces, type TaskActionResult } from "./manage-actions";

export async function synchronizeMicrosoft(): Promise<TaskActionResult> {
  const userId = await requireOwnerId();
  try { await syncMicrosoft(userId); await refreshTaskSurfaces(); return { saved: true }; }
  catch (error) {
    if (error instanceof TaskManagementError) { await refreshTaskSurfaces(); return { error: error.message }; }
    console.error("Microsoft synchronization failed", error);
    return { error: "No se pudo sincronizar Microsoft To Do Revisa la conexión antes de reintentar" };
  }
}
export async function resolveMicrosoftConflict(resolution: "local" | "remote"): Promise<TaskActionResult> {
  const userId = await requireOwnerId();
  if (resolution !== "local" && resolution !== "remote") throw new Error("Invalid Microsoft conflict resolution");
  try { await syncMicrosoft(userId, resolution); await refreshTaskSurfaces(); return { saved: true }; }
  catch (error) {
    if (error instanceof TaskManagementError) { await refreshTaskSurfaces(); return { error: error.message }; }
    console.error("Microsoft conflict resolution failed", error);
    return { error: "No se pudieron resolver los conflictos Revisa la conexión" };
  }
}
export async function disconnectMicrosoft(): Promise<TaskActionResult> {
  const userId = await requireOwnerId();
  await getPrisma().microsoftConnection.updateMany({ where: { userId }, data: { refreshToken: "", lockedUntil: null, error: null } });
  await refreshTaskSurfaces();
  return { saved: true };
}
