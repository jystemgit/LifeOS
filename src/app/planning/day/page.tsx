import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { DailyPlanner } from "@/components/daily-planner";
import { getCalendarDate } from "@/domain/calendar-date";
import { OWNER_TIME_ZONE, calendarDateSchema } from "@/domain/daily-planning";
import { readHourlyPlan } from "@/lib/hourly-planning";
import { requireOwnerId } from "@/lib/require-owner";
import { getPrisma } from "@/lib/prisma";
import { emptyHours } from "@/domain/hourly-planning";

export const instant = false;

export default async function DailyPlanningPage({ searchParams }: {
  searchParams: Promise<{ date?: string }>;
}) {
  const userId = await requireOwnerId();
  const date = (await searchParams).date ?? getCalendarDate(OWNER_TIME_ZONE);
  if (!calendarDateSchema.safeParse(date).success) notFound();
  const plan = await readHourlyPlan(getPrisma(), userId, date);
  return (
    <AppShell>
      <DailyPlanner key={date} initial={plan ?? { date, hours: emptyHours() }} />
    </AppShell>
  );
}
