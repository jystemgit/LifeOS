"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
import { requireOwnerId } from "@/lib/require-owner";
import { publishHourlyPlan } from "@/lib/hourly-planning";
import type { HourlyPlanResult } from "@/domain/hourly-planning";

export async function publishDailyPlan(raw: unknown): Promise<HourlyPlanResult> {
  const userId = await requireOwnerId();
  try {
    const plan = await publishHourlyPlan(getPrisma(), userId, raw);
    revalidatePath("/");
    revalidatePath("/planning/day");
    return { plan };
  } catch (error) {
    if (error instanceof z.ZodError) return { error: "Revisa la fecha y las 24 horas del plan" };
    console.error("Hourly plan publication failed", error);
    return { error: "No se pudo publicar el plan Inténtalo de nuevo" };
  }
}
