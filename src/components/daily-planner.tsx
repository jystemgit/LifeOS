"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/language-provider";
import { hourLabel, type HourlyPlan } from "@/domain/hourly-planning";
import { publishDailyPlan } from "@/app/planning/day/actions";

export function DailyPlanner({ initial }: { initial: HourlyPlan }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [hours, setHours] = useState(initial.hours);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const publishing = useRef(false);

  function publish(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (publishing.current) return;
    publishing.current = true;
    setMessage("");
    setError("");
    startTransition(async () => {
      try {
        const result = await publishDailyPlan({ date: initial.date, hours });
        if (!result.plan) {
          setError(t(result.error));
        } else {
          setHours(result.plan.hours);
          setMessage(t("Plan publicado"));
          router.refresh();
        }
      } catch (cause) {
        console.error("Unable to publish hourly plan", cause);
        setError(t("No se pudo publicar el plan Inténtalo de nuevo"));
      } finally {
        publishing.current = false;
      }
    });
  }

  return (
    <div className="hourly-planner">
      <div className="page-heading">
        <h1>{t("Planificar mi día")}</h1>
        <label className="hourly-plan-date">
          {t("Fecha")}
          <input type="date" value={initial.date} disabled={pending} onChange={(event) => {
            if (event.target.value) router.push(`/planning/day?date=${event.target.value}`);
          }} />
        </label>
      </div>
      <form onSubmit={publish}>
        <table className="hourly-sheet">
          <thead><tr><th scope="col">{t("Hora")}</th><th scope="col">{t("Actividad")}</th></tr></thead>
          <tbody>
            {hours.map((text, hour) => (
              <tr key={hour}>
                <th scope="row"><label htmlFor={`hour-${hour}`}>{hourLabel(hour)}</label></th>
                <td><input id={`hour-${hour}`} type="text" value={text} maxLength={2000}
                  disabled={pending} autoComplete="off" onChange={(event) => {
                    setHours((current) => current.map((value, index) => index === hour ? event.target.value : value));
                    setMessage("");
                    setError("");
                  }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="hourly-plan-publish">
          {error && <p className="form-error" role="alert">{error}</p>}
          {message && <p role="status">{message}</p>}
          <button type="submit" className="auth-submit" disabled={pending}>
            {t(pending ? "Publicando" : "Planificar mi día")}
          </button>
        </div>
      </form>
    </div>
  );
}
