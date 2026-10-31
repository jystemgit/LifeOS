import Link from "next/link";
import { LocalizedText } from "@/components/language-provider";
import { hourLabel, type HourlyPlan } from "@/domain/hourly-planning";

export function DailySchedule({ plan, date }: { plan: HourlyPlan | null; date: string }) {
  const entries = plan?.hours.flatMap((text, hour) => text.trim() ? [{ text, hour }] : []) ?? [];
  return (
    <section className="section" aria-labelledby="today-plan-title">
      <h2 id="today-plan-title"><LocalizedText>Plan de hoy</LocalizedText></h2>
      {entries.length ? (
        <ul className="hourly-published-plan">
          {entries.map(({ text, hour }) => (
            <li key={hour}><time dateTime={`${date}T${hourLabel(hour)}`}>{hourLabel(hour)}</time><span>{text}</span></li>
          ))}
        </ul>
      ) : (
        <p className="section-note">
          <LocalizedText>No hay actividades publicadas para este día</LocalizedText>{" "}
          <Link href={`/planning/day?date=${date}`}><LocalizedText>Planificar mi día</LocalizedText></Link>
        </p>
      )}
    </section>
  );
}
