"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLanguage, LocalizedDate } from "@/components/language-provider";
import { saveManagedTask, manageStep, uploadTaskAttachment, removeTaskAttachment, manageRecurrenceLocally, type TaskActionResult } from "@/app/tasks/manage-actions";
import { TASK_STATUS_LABELS, taskStatuses, taskQuadrant, QUADRANTS, type TaskSummary, type ManagedTaskInput, type TaskRecurrence } from "@/domain/task-management";
import { zonedDateTime, OWNER_TIME_ZONE, minuteLabel, localMinute } from "@/domain/daily-planning";
import { getCalendarDate } from "@/domain/calendar-date";

type Option = { id: string; name: string };
export type TaskOptions = {
  lists: (Option & { description: string; folderId: string | null; icon: string; color: string; position: number; defaultSort: string; defaultView: string; showCompleted: boolean; showDetails: boolean; archivedAt: string | null; deletedAt: string | null })[];
  folders: (Option & { position: number })[];
  savedViews: { id: string; name: string; query: string }[];
};
export type TaskHistoryItem = { id: string; type: string; createdAt: string; before: string; after: string };
export type AttachmentItem = { id: string; name: string; size: number };
function editorValue(task?: TaskSummary, listId?: string, date?: string): ManagedTaskInput {
  return { ...(task ? { id: task.id, version: task.version } : {}),
    title: task?.title ?? "", description: task?.description ?? "", notes: task?.notes ?? "",
    listId: task?.listId ?? listId ?? null,
    status: task?.status ?? "INBOX", priority: task?.priority ?? "MEDIUM",
    important: task?.important ?? false, urgent: task?.urgent ?? false,
    eisenhowerClassified: task?.eisenhowerClassified ?? false,
    scheduledDate: task?.scheduledDate ?? date ?? null, deadline: task?.deadline ?? null,
    startTime: task?.startTime ?? null, endTime: task?.endTime ?? null,
    estimatedMinutes: task?.estimatedMinutes ?? null, reminderAt: task?.reminderAt ?? null,
    tags: task?.tags ?? [], category: task?.category ?? "", customFields: task?.customFields ?? {},
    links: task?.links ?? [], recurrence: task?.recurrence ?? null };
}
export function TaskEditor({ task, options, history, attachments, today, listId, date, close }: {
  task?: TaskSummary; options: TaskOptions; history: TaskHistoryItem[]; attachments: AttachmentItem[];
  today: string; listId?: string; date?: string; close: () => void;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [value, setValue] = useState(() => editorValue(task, listId, date));
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState("");
  const [json, setJson] = useState(JSON.stringify(value.customFields, null, 2));
  const [tagsText, setTagsText] = useState(value.tags.join(", "));
  const [linksText, setLinksText] = useState(value.links.join("\n"));
  const [dirty, setDirty] = useState(false);
  const [sourceVersion, setSourceVersion] = useState(task?.version);
  if (sourceVersion !== task?.version) {
    setSourceVersion(task?.version);
    if (!dirty) {
      const fresh = editorValue(task, listId, date);
      setValue(fresh); setJson(JSON.stringify(fresh.customFields, null, 2));
      setTagsText(fresh.tags.join(", ")); setLinksText(fresh.links.join("\n"));
    }
  }
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape" && (!dirty || confirm(t("Descartar los cambios sin guardar")))) close();
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [close, dirty, t]);
  function patch(data: Partial<ManagedTaskInput>) { setValue((old) => ({ ...old, ...data })); setDirty(true); }
  function run(action: () => Promise<TaskActionResult>) {
    setError("");
    startTransition(async () => {
      try { const result = await action(); if (result.error) setError(t(result.error)); else router.refresh(); }
      catch (cause) { console.error("Task detail action failed", cause); setError(t("No se pudo guardar Inténtalo otra vez")); }
    });
  }
  function save() {
    let customFields: unknown;
    try { customFields = JSON.parse(json); } catch { setError(t("Los campos personalizados deben ser un objeto JSON válido")); return; }
    run(async () => {
      const result = await saveManagedTask({ ...value, customFields,
        tags: tagsText.split(",").map((s) => s.trim()).filter(Boolean), links: linksText.split("\n").map((s) => s.trim()).filter(Boolean) });
      if (!result.error && result.id) {
        setDirty(false);
        const query = new URLSearchParams(location.search);
        query.set("task", result.id);
        router.push(`/tasks?${query}`);
      }
      return result;
    });
  }
  const recurrence = value.recurrence;
  const updateRule = (update: Partial<TaskRecurrence>) => patch({ recurrence: { frequency: "DAILY", interval: 1, startDate: value.scheduledDate ?? today, endDate: null, weekdays: [], ...recurrence, ...update } });
  const reminder = value.reminderAt ? `${getCalendarDate(OWNER_TIME_ZONE, new Date(value.reminderAt))}T${minuteLabel(localMinute(new Date(value.reminderAt)))}` : "";
  return <aside className="task-detail-pane" aria-label={t("Detalles de tarea")}>
    <div className="tm-toolbar"><h2>{t(task ? "Detalles de tarea" : "Nueva tarea")}</h2><button className="auth-text-button" type="button" onClick={() => {
      if (!dirty || confirm(t("Descartar los cambios sin guardar"))) close();
    }}>{t("Cerrar")}</button></div>
    <form className="task-form" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <fieldset disabled={pending || !!task?.deletedAt} className="planner-fieldset">
        <label>{t("Título")}<input autoFocus value={value.title} required maxLength={200} onChange={(e) => patch({ title: e.target.value })} /></label>
        <label>{t("Lista")}<select value={value.listId ?? ""} onChange={(e) => patch({ listId: e.target.value || null })}>
          <option value="">{t("Sin lista")}</option>{options.lists.filter((l) => !l.deletedAt).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select></label>
        <label>{t("Cuadrante Eisenhower")}<select value={taskQuadrant(value) ?? ""} onChange={(event) => {
          const entry = Object.entries(QUADRANTS).find(([key]) => key === event.target.value);
          patch(entry ? { important: entry[1].important, urgent: entry[1].urgent, eisenhowerClassified: true }
            : { important: false, urgent: false, eisenhowerClassified: false });
        }}>
          <option value="">{t("Sin clasificación")}</option>
          {Object.entries(QUADRANTS).map(([key, q]) => <option key={key} value={key}>{t(q.label)}</option>)}
        </select></label>
        <div className="task-form-row">
          <label>{t("Estado")}<select value={value.status} onChange={(e) => { const status = taskStatuses.find((s) => s === e.target.value); if (status) patch({ status }); }}>
            {taskStatuses.map((status) => <option key={status} value={status}>{t(TASK_STATUS_LABELS[status])}</option>)}
          </select></label>
          <label>{t("Prioridad")}<select value={value.priority} onChange={(e) => { const p = e.target.value; if (p === "LOW" || p === "MEDIUM" || p === "HIGH" || p === "CRITICAL") patch({ priority: p }); }}>
            {Object.entries({ LOW: "Baja", MEDIUM: "Media", HIGH: "Alta", CRITICAL: "Crítica" }).map(([p, text]) => <option key={p} value={p}>{t(text)}</option>)}
          </select></label>
        </div>
        <label>{t("Descripción")}<textarea value={value.description} maxLength={2000} onChange={(e) => patch({ description: e.target.value })} /></label>
        <label>{t("Notas")}<textarea value={value.notes} maxLength={10000} onChange={(e) => patch({ notes: e.target.value })} /></label>
        <label>{t("Fecha límite")}<input type="date" value={value.deadline ?? ""} onChange={(e) => patch({ deadline: e.target.value || null })} /></label>
        <details><summary>{t("Opciones adicionales")}</summary><div className="task-form">
          <div className="task-form-row">
            <label>{t("Fecha planificada")}<input type="date" value={value.scheduledDate ?? ""} onChange={(e) => patch({ scheduledDate: e.target.value || null })} /></label>
          </div>
          <p className="task-item-meta">{t("El horario de la tarea es independiente del plan por horas")}</p>
          <div className="task-form-row">
            <label>{t("Inicio")}<input type="time" value={value.startTime ?? ""} onChange={(e) => patch({ startTime: e.target.value || null })} /></label>
            <label>{t("Fin")}<input type="time" value={value.endTime === "24:00" ? "00:00" : value.endTime ?? ""} onChange={(e) => patch({ endTime: e.target.value === "00:00" ? "24:00" : e.target.value || null })} /></label>
          </div>
          <label>{t("Duración estimada (minutos)")}<input type="number" min={1} max={1440} value={value.estimatedMinutes ?? ""} onChange={(e) => patch({ estimatedMinutes: e.target.value ? Number(e.target.value) : null })} /></label>
          <label>{t("Recordatorio")}<input type="datetime-local" value={reminder} onChange={(e) => {
            try { patch({ reminderAt: zonedDateTime(e.target.value) }); } catch { setError(t("Hora de recordatorio inválida")); }
          }} /></label>
          <p className="task-item-meta">{t("Avisos con LIFE OS visible y conectado No son notificaciones push en segundo plano")} · {OWNER_TIME_ZONE}</p>
          <label>{t("Repetición")}<select value={recurrence?.frequency ?? ""} onChange={(e) => {
            const frequency = e.target.value;
            if (!frequency) patch({ recurrence: null });
            else if (frequency === "DAILY" || frequency === "WEEKLY" || frequency === "MONTHLY" || frequency === "YEARLY") updateRule({ frequency });
          }}><option value="">{t("No repetir")}</option><option value="DAILY">{t("Diaria")}</option><option value="WEEKLY">{t("Semanal")}</option><option value="MONTHLY">{t("Mensual")}</option><option value="YEARLY">{t("Anual")}</option></select></label>
          {recurrence && <>
            {task?.recurrenceAuthority === "MICROSOFT" && <button type="button" className="auth-text-button" disabled={pending || dirty} onClick={() => {
              if (confirm(t("Administrar recurrencia en LIFE OS Desconecta esta aparición de la sincronización de Microsoft Conserva el historial y genera las siguientes localmente No modifica la serie remota Confirma la transferencia")))
                run(() => manageRecurrenceLocally({ id: task.id, version: task.version, confirmed: true }));
            }}>{t("Administrar recurrencia en LIFE OS")}</button>}
            <label>{t("Intervalo")}<input type="number" min={1} max={365} value={recurrence.interval} onChange={(e) => updateRule({ interval: Number(e.target.value) })} /></label>
            <div className="task-form-row"><label>{t("Desde")}<input type="date" value={recurrence.startDate} onChange={(e) => updateRule({ startDate: e.target.value })} /></label>
              <label>{t("Hasta")}<input type="date" value={recurrence.endDate ?? ""} onChange={(e) => updateRule({ endDate: e.target.value || null })} /></label></div>
            {(recurrence.frequency === "WEEKLY" || recurrence.frequency === "DAILY") && <div className="tm-toolbar">
              {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((day, i) => <label key={day}><input type="checkbox" checked={recurrence.weekdays.includes(i + 1)}
                onChange={(e) => updateRule({ weekdays: e.target.checked ? [...recurrence.weekdays, i + 1] : recurrence.weekdays.filter((d) => d !== i + 1) })} />{t(day)}</label>)}</div>}
            <p className="task-item-meta">{t(task?.recurrenceAuthority === "MICROSOFT"
              ? "Microsoft administra esta serie Las siguientes apariciones se importan al sincronizar LIFE OS no genera otra copia"
              : "Al completar se crea la siguiente ocurrencia independiente Las anteriores conservan su historial")}</p>
          </>}
        </div></details>
        <details><summary>{t("Organización")}</summary><div className="task-form">
          <label>{t("Etiquetas separadas por coma")}<input value={tagsText} onChange={(e) => { setTagsText(e.target.value); setDirty(true); }} /></label>
          <label>{t("Categoría")}<input value={value.category} maxLength={80} onChange={(e) => patch({ category: e.target.value })} /></label>
          <label>{t("Enlaces uno por línea")}<textarea value={linksText} onChange={(e) => { setLinksText(e.target.value); setDirty(true); }} /></label>
          <label>{t("Campos personalizados JSON")}<textarea value={json} onChange={(e) => { setJson(e.target.value); setDirty(true); }} /></label>
        </div></details>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="auth-submit" type="submit">{t(pending ? "Guardando…" : "Guardar cambios")}</button>
      </fieldset>
    </form>
    {task && <>
      <details className="section"><summary>{t("Pasos")}</summary>
        {task.steps.map((item, index) => <div className="tm-step" key={item.id}>
          <input type="checkbox" aria-label={`${t("Completar")} ${item.title}`} checked={item.status === "COMPLETED"} disabled={pending}
            onChange={(e) => run(() => manageStep({ taskId: task.id, id: item.id, title: item.title, position: item.position, completed: e.target.checked }))} />
          <input aria-label={t("Título del paso")} defaultValue={item.title} maxLength={200} onBlur={(e) => {
            if (e.target.value !== item.title) run(() => manageStep({ taskId: task.id, id: item.id, title: e.target.value, position: item.position, completed: item.status === "COMPLETED" }));
          }} />
          <button type="button" className="auth-text-button" disabled={pending || !index} aria-label={`${t("Subir")} ${item.title}`}
            onClick={() => run(() => manageStep({ taskId: task.id, id: item.id, title: item.title, swapWithId: task.steps[index - 1].id }))}>↑</button>
          <button type="button" className="auth-text-button" disabled={pending} aria-label={`${t("Eliminar")} ${item.title}`}
            onClick={() => run(() => manageStep({ taskId: task.id, id: item.id, title: item.title, deleted: true }))}>×</button>
        </div>)}
        <form className="task-form" onSubmit={(e) => { e.preventDefault(); run(async () => { const result = await manageStep({ taskId: task.id, title: step, position: (task.steps.at(-1)?.position ?? -1) + 1 }); if (!result.error) setStep(""); return result; }); }}>
          <label>{t("Añadir subtarea")}<input value={step} onChange={(e) => setStep(e.target.value)} required maxLength={200} /></label>
          <button className="auth-text-button" disabled={pending}>{t("Añadir")}</button>
        </form>
      </details>
      <details className="section"><summary>{t("Archivos adjuntos")}</summary>
        {attachments.map((file) => <div className="tm-toolbar" key={file.id}><a href={`/api/tasks/attachments/${file.id}`}>{file.name} · {Math.ceil(file.size / 1024)} KB</a>
          <button type="button" className="auth-text-button" disabled={pending} onClick={() => run(() => removeTaskAttachment(file.id))}>{t("Eliminar")}</button></div>)}
        <form className="task-form" action={(form) => run(() => uploadTaskAttachment(form))}>
          <input type="hidden" name="taskId" value={task.id} /><label>{t("Adjuntar archivo hasta 5 MB")}<input type="file" name="file" required /></label>
          <button className="auth-text-button" disabled={pending}>{t("Subir archivo")}</button>
        </form>
      </details>
      <details className="section"><summary>{t("Historial de actividad")}</summary>
        <p className="task-item-meta">{t("Creación")}: <LocalizedDate value={new Date(task.createdAt)} options={{ dateStyle: "medium", timeStyle: "short", timeZone: OWNER_TIME_ZONE }} /></p>
        {task.completedAt && <p className="task-item-meta">{t("Completada")}: <LocalizedDate value={new Date(task.completedAt)} options={{ dateStyle: "medium", timeStyle: "short", timeZone: OWNER_TIME_ZONE }} /></p>}
        {history.map((h) => <details className="tm-history" key={h.id}><summary><LocalizedDate value={new Date(h.createdAt)} options={{ dateStyle: "short", timeStyle: "short", timeZone: OWNER_TIME_ZONE }} /> · {h.type}</summary><pre>{h.before}</pre><pre>{h.after}</pre></details>)}
      </details>
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </aside>;
}
