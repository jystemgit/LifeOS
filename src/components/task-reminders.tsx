"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useLanguage } from "./language-provider";
import { acknowledgeReminder } from "@/app/tasks/manage-actions";

const reminderSchema = z.array(z.object({ id: z.string(), title: z.string(), reminderAt: z.iso.datetime() }));
type Reminder = z.infer<typeof reminderSchema>[number];
export function TaskReminders() {
  const { t } = useLanguage();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState<string[]>([]);
  const acknowledgedRevision = useRef(0);
  const acknowledging = useRef(new Set<string>());
  useEffect(() => {
    let active = true, reading = false;
    const controller = new AbortController();
    async function read() {
      if (reading || document.visibilityState === "hidden") return;
      reading = true;
      const revision = acknowledgedRevision.current;
      try {
        const response = await fetch("/api/tasks/reminders", { cache: "no-store", signal: controller.signal });
        if (response.status === 401) { if (active) setReminders([]); return; }
        if (!response.ok) throw new Error(`Reminder response ${response.status}`);
        const result = reminderSchema.parse(await response.json());
        if (active && revision === acknowledgedRevision.current) { setReminders(result); setError(false); }
      } catch (cause) {
        if (!controller.signal.aborted) {
          console.error("Task reminders could not be loaded", cause);
          if (active) setError(true);
        }
      } finally { reading = false; }
    }
    void read();
    const timer = setInterval(() => void read(), 30000);
    document.addEventListener("visibilitychange", read);
    window.addEventListener("online", read);
    window.addEventListener("focus", read);
    return () => {
      active = false; controller.abort(); clearInterval(timer);
      document.removeEventListener("visibilitychange", read);
      window.removeEventListener("online", read); window.removeEventListener("focus", read);
    };
  }, []);
  if (!reminders.length && !error) return null;
  return <aside className="tm-reminders" aria-label={t("Recordatorios en la aplicación")}>
    <p className="task-item-meta">{t("Avisos con LIFE OS visible y conectado No son notificaciones push en segundo plano")}</p>
    {error && <p role="alert">{t("No se pudieron cargar o confirmar los recordatorios")}</p>}
    {reminders.map((reminder) => <div key={`${reminder.id}:${reminder.reminderAt}`} role="status">
      <Link href={`/tasks?task=${reminder.id}`}>{t("Recordatorio")}: {reminder.title}</Link>
      <button type="button" className="auth-text-button" disabled={pending.includes(reminder.id)}
        aria-label={`${t("Descartar aviso")} ${reminder.title}`} onClick={async () => {
          if (acknowledging.current.has(reminder.id)) return;
          acknowledging.current.add(reminder.id);
          setPending((ids) => [...ids, reminder.id]);
          try {
            const result = await acknowledgeReminder({ id: reminder.id, reminderAt: reminder.reminderAt });
            if (result.error) { console.error("Reminder acknowledgement failed", result.error); setError(true); }
            else { acknowledgedRevision.current++; setReminders((current) => current.filter((item) => item.id !== reminder.id || item.reminderAt !== reminder.reminderAt)); setError(false); }
          } catch (cause) { console.error("Reminder acknowledgement failed", cause); setError(true); }
          finally { acknowledging.current.delete(reminder.id); setPending((ids) => ids.filter((id) => id !== reminder.id)); }
        }}>×</button>
    </div>)}
  </aside>;
}
