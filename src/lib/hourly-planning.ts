import type { PrismaClient } from "@/generated/prisma/client";
import { getCalendarDate } from "@/domain/calendar-date";
import { calendarDateSchema, OWNER_TIME_ZONE } from "@/domain/daily-planning";
import { hourlyEntriesSchema, hourlyPlanSchema, type HourlyPlan } from "@/domain/hourly-planning";

export async function readHourlyPlan(db: PrismaClient, userId: string, date: string): Promise<HourlyPlan | null> {
  calendarDateSchema.parse(date);
  const plan = await db.dailyPlan.findUnique({
    where: { userId_date: { userId, date: new Date(`${date}T00:00:00Z`) } },
    select: { publishedHours: true },
  });
  return plan?.publishedHours == null ? null : { date, hours: hourlyEntriesSchema.parse(plan.publishedHours) };
}

export async function readTodayHourlyPlan(db: PrismaClient, userId: string, instant = new Date()) {
  const date = getCalendarDate(OWNER_TIME_ZONE, instant);
  return { date, plan: await readHourlyPlan(db, userId, date) };
}

export async function publishHourlyPlan(db: PrismaClient, userId: string, raw: unknown): Promise<HourlyPlan> {
  const plan = hourlyPlanSchema.parse(raw);
  await db.$transaction(async (tx) => {
    await tx.dailyPlan.upsert({
      where: { userId_date: { userId, date: new Date(`${plan.date}T00:00:00Z`) } },
      create: { userId, date: new Date(`${plan.date}T00:00:00Z`), publishedHours: plan.hours },
      update: { publishedHours: plan.hours },
    });
  });
  return plan;
}
