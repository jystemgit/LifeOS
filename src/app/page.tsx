
import { LocalizedDate, LocalizedText } from "@/components/language-provider";
import { AppShell } from "@/components/app-shell";
import { getAuthSession } from "@/lib/auth-session";
import { redirect } from "next/navigation";
import { DailySchedule } from "@/components/daily-schedule";
import { readTodayHourlyPlan } from "@/lib/hourly-planning";
import { getPrisma } from "@/lib/prisma";
import { readManagedTasks } from "@/lib/task-management";
import { DailyTasks } from "@/components/daily-tasks";

export const instant = false;

export default async function Home() {
  const session = await getAuthSession();
  if (!session) {
    redirect("/sign-in");
  }
  if (session.user.twoFactorEnabled !== true) {
    redirect("/security");
  }
  const { date, plan } = await readTodayHourlyPlan(getPrisma(), session.user.id);
  const tasks = await readManagedTasks(getPrisma(), session.user.id);

  return (
    <AppShell>
      <div className="page-heading">
        <div>
          <h1><LocalizedText>CENTRO DE COMANDO</LocalizedText></h1>
        </div>
        <p className="date-label"><LocalizedDate value={new Date()} options={{ weekday: "long", day: "numeric", month: "long", timeZone: "America/Argentina/Buenos_Aires" }} /></p>
      </div>

      <DailySchedule plan={plan} date={date} />
      <DailyTasks tasks={tasks} date={date} />

      <footer className="dashboard-footer">
        <span>LIFE OS</span>
        <span><LocalizedText>El recorrido recién empieza</LocalizedText></span>
      </footer>
    </AppShell>
  );
}
