"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Star, Plus, List, BookOpen, BriefcaseBusiness, House, Target } from "lucide-react";
import { LocalizedDate, useLanguage } from "@/components/language-provider";
import { TaskEditor, type TaskOptions, type TaskHistoryItem, type AttachmentItem } from "@/components/task-editor";
import { WORKSPACE_VIEWS, QUADRANTS, taskQuadrant, filterTasks, taskCalendarMonth, TASK_STATUS_LABELS, TASK_SORT_LABELS, TASK_VIEW_LABELS, type TaskSummary, type TaskFilters, type Quadrant, type TaskCompletionAnalysis } from "@/domain/task-management";
import { saveManagedTask, saveManagedList, manageTasks, manageOrganization, reorderTasks, saveTaskView, deleteTaskView, duplicateTask, type TaskActionResult } from "@/app/tasks/manage-actions";
import { synchronizeMicrosoft, disconnectMicrosoft, resolveMicrosoftConflict } from "@/app/tasks/microsoft-actions";
import { synchronizeGoogle, disconnectGoogle } from "@/app/tasks/google-actions";

type Props = {
  tasks: TaskSummary[]; today: string; date: string; query: Record<string, string>; options: TaskOptions;
  history: TaskHistoryItem[]; attachments: AttachmentItem[];
  completionAnalysis: TaskCompletionAnalysis;
  microsoft: { configured: boolean; connected: boolean; lastSyncAt: string | null; error: string | null;
    conflicts: { id: string; taskId?: string; listId?: string; title: string; detail: string }[] };
  google: { configured: boolean; connected: boolean; lastSyncAt: string | null; error: string | null;
    conflicts: { taskId: string; title: string; detail: string }[] };
};
const icons = { list: List, book: BookOpen, briefcase: BriefcaseBusiness, home: House, target: Target };

export function TaskWorkspace({ tasks, today, date, query, options, history, attachments, microsoft, google, completionAnalysis }: Props) {
  const { t } = useLanguage();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [newTask, setNewTask] = useState(false);
  const [editingList, setEditingList] = useState<string | null>(null);
  const [listName, setListName] = useState("");
  const [folderName, setFolderName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [sort, setSort] = useState(query.sort ?? "position");
  const titleRef = useRef<HTMLInputElement>(null);
  const view = query.view ?? "active";
  const currentList = options.lists.find((l) => l.id === query.list);
  const mode = query.mode ?? currentList?.defaultView ?? (view === "matrix" ? "matrix" : "standard");
  const [search, setSearch] = useState(query.q ?? "");
  const filters: TaskFilters = { ...query, view, q: search };
  const filtered = filterTasks(tasks, filters, date, today).filter((task) => currentList?.showCompleted === false ? task.status !== "COMPLETED" : true);
  const sorted = [...filtered].sort((a, b) => {
    const sorting = query.sort ?? (sort !== "position" ? sort : currentList?.defaultSort ?? "position");
    if (sorting === "title") return a.title.localeCompare(b.title);
    if (sorting === "deadline") return (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999");
    if (sorting === "createdAt") return b.createdAt.localeCompare(a.createdAt);
    if (sorting === "priority") return ["CRITICAL", "HIGH", "MEDIUM", "LOW"].indexOf(a.priority) - ["CRITICAL", "HIGH", "MEDIUM", "LOW"].indexOf(b.priority);
    if (view === "today") return (a.assignments.find((d) => d.date === date)?.position ?? a.position) - (b.assignments.find((d) => d.date === date)?.position ?? b.position);
    return a.position - b.position;
  });
  const task = tasks.find((a) => a.id === query.task);
  const month = taskCalendarMonth(date);
  const complete = sorted.filter((a) => (view === "today" && date < today ? a.assignments.find((d) => d.date === date)?.statusSnapshot : a.status) === "COMPLETED").length;
  const heading = currentList?.name ?? t(WORKSPACE_VIEWS[view as keyof typeof WORKSPACE_VIEWS] ?? "Todas las tareas");
  function href(update: Record<string, string | undefined>) {
    const params = new URLSearchParams(query);
    for (const [key, value] of Object.entries(update)) if (value) params.set(key, value); else params.delete(key);
    return `/tasks?${params}`;
  }
  function run(action: () => Promise<TaskActionResult>, after?: () => void) {
    setError("");
    startTransition(async () => {
      try {
        const result = await action();
        if (result.error) setError(t(result.error)); else { after?.(); router.refresh(); }
      } catch (cause) { console.error("Task workspace action failed", cause); setError(t("No se pudo guardar Inténtalo otra vez")); }
    });
  }
  function command(ids: string[], action: string, value = "", selectedDate?: string) {
    run(() => manageTasks({ ids, action, value, ...(selectedDate ? { date: selectedDate } : {}) }));
  }
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); titleRef.current?.focus(); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  function quickAdd(title: string, q?: Quadrant) {
    if (!title.trim()) { setError(t("Escribe un título")); return; }
    run(() => saveManagedTask({ title, listId: query.list ?? null,
      ...(view === "today" ? { scheduledDate: date } : {}),
      ...(q ? { ...QUADRANTS[q], eisenhowerClassified: true } : {}) }), () => setTitle(""));
  }
  function taskCard(a: TaskSummary) {
    const past = view === "today" && date < today ? a.assignments.find((d) => d.date === date) : null;
    const completed = past ? past.statusSnapshot === "COMPLETED" : a.status === "COMPLETED";
    return <article className={`tm-card${completed ? " tm-completed" : ""}`} key={a.id}
      draggable={!pending && !a.deletedAt} onDragStart={(event) => event.dataTransfer.setData("text/lifeos-task", a.id)}
      onDragOver={(event) => { if (!pending) event.preventDefault(); }}
      onDrop={(event) => {
        if (mode === "matrix" || mode === "board" || view === "matrix") return;
        event.preventDefault(); event.stopPropagation();
        const id = event.dataTransfer.getData("text/lifeos-task");
        if (!tasks.some((task) => task.id === id)) return;
        const reordered = sorted.filter((task) => task.id !== id);
        const position = reordered.findIndex((task) => task.id === a.id); reordered.splice(Math.max(0, position), 0, tasks.find((task) => task.id === id)!);
        run(() => reorderTasks({ ids: reordered.map((task) => task.id), ...(view === "today" ? { date } : {}) }));
      }}>
      <div className="tm-card-top">
        <input type="checkbox" checked={selected.includes(a.id)} aria-label={`${t("Seleccionar")} ${a.title}`}
          onChange={(event) => setSelected((s) => event.target.checked ? [...s, a.id] : s.filter((id) => id !== a.id))} />
        <button type="button" className="tm-check" disabled={pending || !!a.deletedAt || !!past} aria-label={`${t(completed ? "Reabrir" : "Completar")} ${a.title}`}
          onClick={() => command([a.id], completed ? "reopen" : "complete")}>{completed ? "✓" : ""}</button>
        {renaming === a.id ? <form className="tm-inline-title" onSubmit={(e) => {
          e.preventDefault(); const title = String(new FormData(e.currentTarget).get("title") ?? "");
          run(() => saveManagedTask({ ...a, title }), () => setRenaming(null));
        }}><input name="title" defaultValue={a.title} aria-label={t("Título")} maxLength={200} required autoFocus />
          <button type="submit" className="auth-text-button" disabled={pending}>{t("Guardar")}</button>
          <button type="button" className="auth-text-button" onClick={() => setRenaming(null)}>{t("Cancelar")}</button></form>
          : <Link className="tm-title" href={href({ task: a.id })}>{past?.titleSnapshot ?? a.title}</Link>}
        <button type="button" className="tm-star" disabled={pending || !!a.deletedAt} onClick={() => command([a.id], "important")} aria-label={`${t("Importante")} ${a.title}`} aria-pressed={a.important}>
          <Star size={16} fill={a.important ? "currentColor" : "none"} /></button>
      </div>
      <div className="tm-card-meta">
        {a.listName && <span>{a.listName}</span>}
        <span>{t(taskQuadrant(a) ? QUADRANTS[taskQuadrant(a)!].label : "Sin clasificación")}</span>
        <span>{t({ LOW: "Baja", MEDIUM: "Media", HIGH: "Alta", CRITICAL: "Crítica" }[a.priority])}</span>
        {a.deadline && <span>{t("Límite")}: <LocalizedDate value={a.deadline} options={{ dateStyle: "short", timeZone: "UTC" }} /></span>}
        {a.steps.length > 0 && <span>{a.steps.filter((step) => step.status === "COMPLETED").length}/{a.steps.length} {t("Pasos")}</span>}
        {a.recurrence && <span>↻ {t("Recurrente")}</span>}
        {!!a.tags.length && <span>{a.tags.map((tag) => `#${tag}`).join(" ")}</span>}
      </div>
      {(mode === "detailed" || currentList?.showDetails && mode !== "compact") && a.description && <p>{a.description}</p>}
      <details className="tm-context"><summary aria-label={`${t("Acciones")} ${a.title}`}>···</summary>
        <div className="tm-toolbar">
          {!a.deletedAt ? <>
            <button type="button" className="auth-text-button" disabled={pending || !!past} onClick={() => setRenaming(a.id)}>{t("Renombrar")}</button>
            <details><summary>{t("Duplicar tarea")}</summary><form className="task-form" onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              run(() => duplicateTask({ id: a.id, version: a.version, subtasks: data.has("subtasks"), deadline: data.has("deadline"),
                scheduledDate: data.has("scheduledDate"), timeWindow: data.has("timeWindow"), reminder: data.has("reminder") }));
            }}>
              {(["subtasks", "deadline", "scheduledDate", "timeWindow", "reminder"] as const).map((field) => <label key={field}>
                <input type="checkbox" name={field} defaultChecked={field === "subtasks"} />{t({ subtasks: "Copiar pasos", deadline: "Copiar fecha límite", scheduledDate: "Copiar fecha planificada", timeWindow: "Copiar horario", reminder: "Copiar recordatorio" }[field])}
              </label>)}
              <p>{t("La copia no incluye finalización historial archivos ni recurrencia")}</p>
              <button disabled={pending} type="submit">{t("Duplicar tarea")}</button>
            </form></details>
            <button type="button" className="auth-text-button" disabled={pending} onClick={() => command([a.id], a.archivedAt ? "unarchive" : "archive")}>{t(a.archivedAt ? "Restaurar tarea archivada" : "Archivar tarea")}</button>
            <button type="button" className="auth-text-button" disabled={pending} onClick={() => command([a.id], "assign", "", date)}>{t("Añadir a mi día")}</button>
            <button type="button" className="auth-text-button" disabled={pending} onClick={() => command([a.id], "unassign", "", date)}>{t("Quitar de mi día")}</button>
            <label>{t("Mover a otra fecha")}<input type="date" min={today} aria-label={t("Mover a otra fecha")} onChange={(event) => {
              const target = event.target.value; if (target) run(() => manageTasks({ ids: [a.id], action: "reschedule", date: target, fromDate: date }));
            }} /></label>
            <select aria-label={t("Mover a lista")} value={a.listId ?? ""} onChange={(event) => command([a.id], "move", event.target.value)}>
              <option value="">{t("Sin lista")}</option>{options.lists.filter((list) => !list.deletedAt).map((list) => <option value={list.id} key={list.id}>{list.name}</option>)}
            </select>
            <select aria-label={t("Cuadrante Eisenhower")} value={taskQuadrant(a) ?? ""} onChange={(event) => command([a.id], "quadrant", event.target.value)}>
              <option value="">{t("Sin clasificación")}</option>
              {Object.entries(QUADRANTS).map(([q, value]) => <option key={q} value={q}>{t(value.label)}</option>)}
            </select>
            <button type="button" className="auth-text-button" disabled={pending} onClick={() => command([a.id], "delete")}>{t("Enviar a papelera")}</button>
          </> : <button type="button" className="auth-text-button" disabled={pending} onClick={() => command([a.id], "restore")}>{t("Restaurar tarea")}</button>}
        </div>
      </details>
    </article>;
  }
  const selectedList = options.lists.find((list) => list.id === editingList);

  return <div className="task-workspace">
    <div className="page-heading"><div><p className="eyebrow">{t("EJECUCIÓN / TAREAS")}</p><h1>{heading}</h1>
      <p className="page-description">{t("Captura, organiza y ejecuta sin duplicar tus tareas")}</p></div>
      <Link className="auth-text-button" href={`/planning/day?date=${date}`}>{t("Planificar mi día")}</Link></div>
    <div className={`tm-layout${task || newTask ? " tm-detail-open" : ""}`}>
      <aside className="tm-navigation">
        <button className="auth-text-button tm-nav-toggle" type="button" aria-expanded={navigationOpen} onClick={() => setNavigationOpen((open) => !open)}>{t("Vistas y listas")}</button>
        <div className="tm-navigation-content" data-expanded={navigationOpen}>
        <nav aria-label={t("Vistas de tareas")}>
          {Object.entries(WORKSPACE_VIEWS).filter(([key]) => ["active", "completed", "all"].includes(key)).map(([key, label]) => <Link key={key} href={href({ view: key, list: undefined, folder: undefined, task: undefined, mode: undefined })}
            aria-current={view === key && !query.list ? "page" : undefined}>{t(label)}</Link>)}
          <details><summary>{t("Más vistas")}</summary>
            {Object.entries(WORKSPACE_VIEWS).filter(([key]) => !["active", "completed", "all"].includes(key)).map(([key, label]) =>
              <Link key={key} href={href({ view: key, list: undefined, folder: undefined, task: undefined, mode: undefined })}
                aria-current={view === key && !query.list ? "page" : undefined}>{t(label)}</Link>)}
          </details>
        </nav>
        <h3>{t("Mis listas")}</h3>
        {options.lists.filter((l) => !l.folderId && !l.deletedAt && !l.archivedAt).map((l) => {
          const Icon = icons[l.icon as keyof typeof icons] ?? List;
          return <div className="tm-list-nav" key={l.id} data-tone={l.color}><Link href={href({ list: l.id, view: "all", mode: undefined })}><Icon size={14} />{l.name}</Link>
            <button className="auth-text-button" type="button" onClick={() => setEditingList(l.id)} aria-label={`${t("Editar")} ${l.name}`}>···</button></div>;
        })}
        {options.folders.map((folder, folderIndex) => <details key={folder.id} open className="tm-folder"><summary>{folder.name}</summary>
          {options.lists.filter((l) => l.folderId === folder.id && !l.deletedAt && !l.archivedAt).map((l) => <div key={l.id} className="tm-list-nav">
            <Link href={href({ list: l.id, view: "all", mode: undefined })}>{l.name}</Link><button type="button" className="auth-text-button" onClick={() => setEditingList(l.id)}>···</button></div>)}
          <div className="tm-toolbar">
            <button className="auth-text-button" type="button" onClick={() => { const name = prompt(t("Nombre de carpeta"), folder.name); if (name?.trim()) run(() => manageOrganization({ kind: "folder", action: "save", id: folder.id, name })); }}>{t("Renombrar")}</button>
            <button className="auth-text-button" type="button" disabled={!folderIndex || pending} aria-label={t("Subir carpeta")} onClick={() => run(async () => {
              const previous = options.folders[folderIndex - 1];
              return manageOrganization({ kind: "folder", action: "swap", id: folder.id, otherId: previous.id });
            })}>↑</button>
            <button className="auth-text-button" type="button" disabled={pending} onClick={() => {
              if (confirm(t("Eliminar la carpeta conservando sus listas"))) run(() => manageOrganization({ kind: "folder", action: "delete", id: folder.id }));
            }}>{t("Eliminar carpeta")}</button>
          </div>
        </details>)}
        <form className="task-form" onSubmit={(e) => { e.preventDefault(); run(() => saveManagedList({ name: listName }), () => setListName("")); }}>
          <label>{t("Nueva lista")}<input value={listName} onChange={(e) => setListName(e.target.value)} required maxLength={120} /></label>
          <button type="submit" className="auth-text-button" disabled={pending}>{t("Crear lista")}</button>
        </form>
        <form className="task-form" onSubmit={(e) => { e.preventDefault(); run(() => manageOrganization({ kind: "folder", action: "save", name: folderName }), () => setFolderName("")); }}>
          <label>{t("Nueva carpeta")}<input value={folderName} onChange={(e) => setFolderName(e.target.value)} required maxLength={120} /></label>
          <button type="submit" className="auth-text-button" disabled={pending}>{t("Crear carpeta")}</button>
        </form>
        <details><summary>{t("Listas archivadas y eliminadas")}</summary>{options.lists.filter((l) => l.archivedAt || l.deletedAt).map((l) => <div className="tm-list-nav" key={l.id}><Link href={href({ list: l.id, view: l.archivedAt ? "archived" : "trash" })}>{l.name}</Link>
          <button className="auth-text-button" type="button" disabled={pending} onClick={() => run(() => manageOrganization({ kind: "list", id: l.id, action: "restore" }))}>{t("Restaurar")}</button></div>)}</details>
        {!!options.savedViews.length && <details open><summary>{t("Vistas guardadas")}</summary>{options.savedViews.map((v) => <div className="tm-list-nav" key={v.id}>
          <Link className="tm-saved-view" href={`/tasks${v.query}`}>{v.name}</Link>
          <button type="button" className="auth-text-button" disabled={pending} aria-label={`${t("Eliminar vista")} ${v.name}`} onClick={() => {
            if (confirm(t("Eliminar esta vista guardada"))) run(() => deleteTaskView(v.id));
          }}>{t("Eliminar")}</button>
        </div>)}</details>}
        </div>
      </aside>
      <section className="tm-main" aria-label={heading}>
        {error && <p className="form-error" role="alert">{error}</p>}
        <form className="tm-quick-add" onSubmit={(event) => { event.preventDefault(); quickAdd(title); }}>
          <Plus size={18} /><input ref={titleRef} aria-label={t("Añadir tarea")} placeholder={t("Escribe una tarea y pulsa Enter")} value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} />
          <button type="submit" disabled={pending}>{t("Añadir")}</button>
          <button type="button" onClick={() => { setNewTask(true); router.push(href({ task: undefined })); }}>{t("Detalles")}</button>
        </form>
        <div className="tm-toolbar tm-view-bar">
          <input type="search" aria-label={t("Buscar tareas")} placeholder={t("Buscar título, notas, lista o etiquetas")} value={search} onChange={(e) => setSearch(e.target.value)} />
          <select aria-label={t("Cuadrante Eisenhower")} value={query.quadrant ?? ""} onChange={(e) => router.push(href({ quadrant: e.target.value || undefined }))}>
            <option value="">{t("Todos los cuadrantes")}</option>
            <option value="none">{t("Sin clasificación")}</option>
            {Object.entries(QUADRANTS).map(([key, q]) => <option key={key} value={key}>{t(q.label)}</option>)}
          </select>
          <details><summary>{t("Presentación")}</summary>
          <select aria-label={t("Vista")} value={mode} onChange={(e) => router.push(href({ mode: e.target.value }))}>
            {Object.entries(TASK_VIEW_LABELS).map(([key, text]) => <option key={key} value={key}>{t(text)}</option>)}
          </select>
          </details>
          <select aria-label={t("Ordenar")} value={query.sort ?? sort} onChange={(e) => { setSort(e.target.value); router.push(href({ sort: e.target.value })); }}>
            {Object.entries(TASK_SORT_LABELS).map(([key, text]) => <option key={key} value={key}>{t(text)}</option>)}
          </select>
          {view === "today" && <input type="date" aria-label={t("Fecha de mi día")} value={date} onChange={(e) => { if (e.target.value) router.push(href({ date: e.target.value })); }} />}
          {currentList && <button className="auth-text-button" type="button" onClick={() => setEditingList(currentList.id)}>{t("Configurar lista")}</button>}
        </div>
        <details className="tm-filters"><summary>{t("Filtros combinados")}</summary>
          <form action="/tasks" className="task-form">
            <input name="view" value={view} type="hidden" />
            <input name="q" value={search} type="hidden" />
            <div className="tm-filter-grid">
              {([
                ["list", "Lista", options.lists.filter((l) => !l.deletedAt)],
                ["folder", "Carpeta", options.folders],
                ["quadrant", "Eisenhower", Object.entries(QUADRANTS).map(([id, q]) => ({ id, name: t(q.label) }))],
                ["status", "Estado", Object.entries(TASK_STATUS_LABELS).map(([id, name]) => ({ id, name: t(name) }))],
                ["priority", "Prioridad", Object.entries({ LOW: "Baja", MEDIUM: "Media", HIGH: "Alta", CRITICAL: "Crítica" }).map(([id, name]) => ({ id, name: t(name) }))],
              ] as const).map(([key, label, values]) => <label key={key}>{t(label)}<select name={key} defaultValue={query[key] ?? ""}>
                <option value="">{t("Todas")}</option>{values.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>)}
              {(["important", "urgent", "recurrence"] as const).map((key) => <label key={key}>{t({ important: "Importante", urgent: "Urgente", recurrence: "Recurrente" }[key])}<select name={key} defaultValue={query[key] ?? ""}>
                <option value="">{t("Todas")}</option><option value="true">{t("Sí")}</option><option value="false">{t("No")}</option></select></label>)}
              <label>{t("Fecha límite")}<input name="due" type="date" defaultValue={query.due} /></label>
              <label>{t("Fecha planificada")}<input name="scheduled" type="date" defaultValue={query.scheduled} /></label>
            </div><button className="auth-text-button" type="submit">{t("Aplicar filtros")}</button>
          </form>
          <button type="button" className="auth-text-button" onClick={() => { const name = prompt(t("Nombre de la vista")); if (name?.trim()) run(() => saveTaskView({ name, query: href({ q: search }).replace("/tasks", "") })); }}>{t("Guardar vista")}</button>
        </details>
        <p className="task-item-meta">{filtered.length} {t("tareas en esta vista")} · {complete} {t("Completadas")}</p>
        {!!selected.length && <div className="tm-toolbar tm-bulk">
          <span>{selected.length} {t("seleccionadas")}</span>
          <button className="auth-text-button" type="button" disabled={pending} onClick={() => command(selected, "complete")}>{t("Completar")}</button>
          <button className="auth-text-button" type="button" disabled={pending} onClick={() => command(selected, "assign", "", date)}>{t("Añadir a mi día")}</button>
          <button className="auth-text-button" type="button" disabled={pending} onClick={() => command(selected, "delete")}>{t("Enviar a papelera")}</button>
          <select aria-label={t("Mover seleccionadas a lista")} value="" onChange={(e) => { if (e.target.value) command(selected, "move", e.target.value); }}>
            <option value="">{t("Mover a lista")}</option>{options.lists.filter((l) => !l.deletedAt).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <button className="auth-text-button" type="button" onClick={() => setSelected([])}>{t("Cancelar selección")}</button>
        </div>}
        {view === "lists" && <div className="tm-list-gallery">{options.lists.filter((l) => !l.deletedAt && !l.archivedAt).map((l) => <Link key={l.id} href={href({ list: l.id, view: "all", mode: undefined })}><h3>{l.name}</h3><p>{l.description}</p><span>{tasks.filter((a) => a.listId === l.id && !a.deletedAt).length} {t("tareas")}</span></Link>)}</div>}
        {mode === "matrix" ? <div className="tm-matrix">
          {Object.entries(QUADRANTS).map(([key, q]) => <section key={key} className="tm-quadrant" onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
            e.preventDefault(); const id = e.dataTransfer.getData("text/lifeos-task"); if (tasks.some((a) => a.id === id)) command([id], "quadrant", key);
          }}>
            <h2>{t(q.label)}</h2><p className="task-item-meta">{t(q.important ? "Importante" : "No importante")} · {t(q.urgent ? "Urgente" : "No urgente")}</p>
            <form className="tm-quadrant-add" onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const title = String(new FormData(form).get("title") ?? ""); quickAdd(title, key as Quadrant); form.reset(); }}>
              <input name="title" aria-label={`${t("Añadir tarea")} ${t(q.label)}`} placeholder={t("Añadir tarea")} required maxLength={200} /><button disabled={pending}>+</button>
            </form>
            {sorted.filter((a) => taskQuadrant(a) === key).map(taskCard)}
          </section>)}
          {sorted.some((a) => !taskQuadrant(a)) && <section className="tm-quadrant">
            <h2>{t("Sin clasificación")}</h2>{sorted.filter((a) => !taskQuadrant(a)).map(taskCard)}
          </section>}
        </div> : mode === "board" ? <div className="tm-board">
          {Object.entries(TASK_STATUS_LABELS).map(([status, name]) => <section key={status} onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
            e.preventDefault(); const id = e.dataTransfer.getData("text/lifeos-task"); if (tasks.some((a) => a.id === id)) command([id], "status", status);
          }}><h3>{t(name)}</h3>{sorted.filter((a) => a.status === status).map(taskCard)}</section>)}
        </div> : mode === "calendar" ? <section className="tm-month" aria-label={t("Calendario de tareas")}>
          <div className="tm-toolbar">
            <Link className="auth-text-button" href={href({ date: month.previous, task: undefined })}>{t("Mes anterior")}</Link>
            <h2><LocalizedDate value={month.first} options={{ month: "long", year: "numeric", timeZone: "UTC" }} /></h2>
            <Link className="auth-text-button" href={href({ date: month.next, task: undefined })}>{t("Mes siguiente")}</Link>
            <Link className="auth-text-button" href={href({ date: today, task: undefined })}>{t("Hoy")}</Link>
          </div>
          <div className="tm-month-grid">
            {month.days.slice(0, 7).map((day) => <div className="tm-month-weekday" key={`weekday-${day}`}><LocalizedDate value={day} options={{ weekday: "short", timeZone: "UTC" }} /></div>)}
            {month.days.map((day) => <section key={day} className={`tm-month-day${day.slice(0, 7) !== month.first.slice(0, 7) ? " tm-month-outside" : ""}`}>
              <h3><Link aria-current={day === today ? "date" : undefined} href={href({ date: day, view: "today", mode: "standard", task: undefined })}>
                <LocalizedDate value={day} options={{ day: "numeric", month: "short", timeZone: "UTC" }} /></Link></h3>
              {sorted.filter((a) => a.deadline === day || a.scheduledDate === day || a.assignments.some((d) => d.date === day)).map((a) => <div className={`tm-month-task${a.status === "COMPLETED" ? " tm-completed" : ""}`} key={a.id}>
                <button type="button" className="tm-check" disabled={pending || !!a.deletedAt} aria-label={`${t(a.status === "COMPLETED" ? "Reabrir" : "Completar")} ${a.title}`}
                  onClick={() => command([a.id], a.status === "COMPLETED" ? "reopen" : "complete")}>{a.status === "COMPLETED" ? "✓" : ""}</button>
                <Link href={href({ task: a.id })}>{a.title}{a.deadline === day && <span className="task-item-meta"> · {t("Fecha límite")}</span>}</Link>
              </div>)}
            </section>)}
          </div>
          {!!sorted.filter((a) => !a.deadline && !a.scheduledDate && !a.assignments.length).length && <details><summary>{t("Sin programar")}</summary>{sorted.filter((a) => !a.deadline && !a.scheduledDate && !a.assignments.length).map(taskCard)}</details>}
        </section> : mode === "agenda" ? <div className="tm-date-groups">
          {[...new Set(sorted.flatMap((a) => [a.deadline, a.scheduledDate, ...a.assignments.map((d) => d.date)]).filter((d): d is string => !!d))].sort().map((day) => <section key={day}>
            <h3><LocalizedDate value={day} options={{ weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }} /></h3>
            {sorted.filter((a) => a.deadline === day || a.scheduledDate === day || a.assignments.some((d) => d.date === day)).map(taskCard)}
          </section>)}
          {!!sorted.filter((a) => !a.deadline && !a.scheduledDate && !a.assignments.length).length && <section><h3>{t("Sin programar")}</h3>{sorted.filter((a) => !a.deadline && !a.scheduledDate && !a.assignments.length).map(taskCard)}</section>}
        </div> : <div className={`tm-task-list tm-${mode}`}>{sorted.map(taskCard)}</div>}
        {!filtered.length && <div className="empty-panel"><p>{t("No hay tareas en esta vista Captura una nueva o ajusta los filtros")}</p></div>}
        <details className="section"><summary>{t("Análisis del historial")}</summary>
          <div className="tm-history-table"><table>
            <caption>{t("Finalizaciones por clasificación histórica")}</caption>
            <thead><tr><th scope="col">{t("Matriz Eisenhower")}</th><th scope="col">{t("Últimos 7 días")}</th><th scope="col">{t("Últimos 30 días")}</th></tr></thead>
            <tbody>{completionAnalysis.map((row) => <tr key={row.quadrant}>
              <th scope="row">{t(row.quadrant === "UNCLASSIFIED" ? "Sin clasificación histórica" : QUADRANTS[row.quadrant].label)}</th>
              <td>{row.last7Days}</td><td>{row.last30Days}</td>
            </tr>)}</tbody>
          </table></div>
          <p className="task-item-meta">{t("Se cuenta una finalización por tarea y día con la clasificación registrada al completar Los cambios posteriores no alteran este análisis")}</p>
        </details>
        <details className="section"><summary>Microsoft To Do</summary>
          <p className="section-note">{t("Cada serie tiene un solo generador Los movimientos conservan los pasos Los archivos y las series nativas requieren revisión Valida con tu cuenta")}</p>
          <p className="section-note">{t("Los pasos sincronizan título y finalización Las eliminaciones y los cambios simultáneos se revisan sin borrar el historial El orden permanece en LIFE OS")}</p>
          {!microsoft.configured ? <p>{t("Configura MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET y MICROSOFT_REDIRECT_URI para autorizar Microsoft To Do")}</p>
            : !microsoft.connected ? <a className="auth-text-button" href="/api/integrations/microsoft/connect">{t("Conectar Microsoft To Do")}</a> : <div className="tm-toolbar">
              <button type="button" className="auth-text-button" disabled={pending} onClick={() => run(synchronizeMicrosoft)}>{t("Sincronizar ahora")}</button>
              <button type="button" className="auth-text-button" disabled={pending} onClick={() => { if (confirm(t("Desconectar Microsoft To Do"))) run(disconnectMicrosoft); }}>{t("Desconectar")}</button>
              {microsoft.lastSyncAt && <span>{t("Última sincronización")}: <LocalizedDate value={new Date(microsoft.lastSyncAt)} /></span>}
            </div>}
          {microsoft.error && <p className="form-error">{microsoft.error}</p>}
          {!!microsoft.conflicts.length && <ul>{microsoft.conflicts.map((conflict) => <li key={conflict.id}>
            <Link href={href({ ...(conflict.taskId ? { task: conflict.taskId } : { list: conflict.listId, view: "all" }) })}>{conflict.title}</Link>
            <details><summary>{t("Detalles del conflicto")}</summary><pre className="tm-conflict-detail">{conflict.detail}</pre></details>
          </li>)}</ul>}
          {microsoft.connected && <div className="tm-toolbar"><button type="button" className="auth-text-button" disabled={pending} onClick={() => {
            if (confirm(t("Resolver conflictos conservando LIFE OS"))) run(() => resolveMicrosoftConflict("local"));
          }}>{t("Conservar LIFE OS en conflictos")}</button><button type="button" className="auth-text-button" disabled={pending} onClick={() => {
            if (confirm(t("Resolver conflictos conservando Microsoft"))) run(() => resolveMicrosoftConflict("remote"));
          }}>{t("Conservar Microsoft en conflictos")}</button></div>}
        </details>
        <details className="section"><summary>Google Calendar</summary>
          <p className="section-note">{t("Sincronización opcional de tareas Independiente del plan por horas")}</p>
          {!google.configured ? <p>{t("Configura GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y GOOGLE_REDIRECT_URI para autorizar Google Calendar")}</p>
            : !google.connected ? <a className="auth-text-button" href="/api/integrations/google/connect">{t("Conectar Google Calendar")}</a>
            : <div className="tm-toolbar">
              <button type="button" className="auth-text-button" disabled={pending} onClick={() => run(() => synchronizeGoogle())}>{t("Sincronizar ahora")}</button>
              <button type="button" className="auth-text-button" disabled={pending} onClick={() => { if (confirm(t("Desconectar Google Calendar"))) run(disconnectGoogle); }}>{t("Desconectar")}</button>
              {google.lastSyncAt && <span>{t("Última sincronización")}: <LocalizedDate value={new Date(google.lastSyncAt)} /></span>}
            </div>}
          {google.error && <p className="form-error" role="alert">{t(google.error)}</p>}
          {!!google.conflicts.length && <ul>{google.conflicts.map((conflict) => <li key={conflict.taskId}>
            <Link href={href({ task: conflict.taskId })}>{conflict.title}</Link>
            <details><summary>{t("Detalles del conflicto")}</summary><pre className="tm-conflict-detail">{conflict.detail}</pre></details>
          </li>)}</ul>}
          {google.connected && <div className="tm-toolbar">
            <button type="button" className="auth-text-button" disabled={pending} onClick={() => {
              if (confirm(t("Resolver conflictos conservando LIFE OS"))) run(() => synchronizeGoogle("local"));
            }}>{t("Conservar LIFE OS en conflictos")}</button>
            <button type="button" className="auth-text-button" disabled={pending} onClick={() => {
              if (confirm(t("Resolver conflictos conservando Google"))) run(() => synchronizeGoogle("remote"));
            }}>{t("Conservar Google en conflictos")}</button>
          </div>}
        </details>
      </section>
      {(task || newTask) && <TaskEditor key={task?.id ?? "new"} task={task} options={options} history={history} attachments={attachments} today={today} listId={query.list}
        date={view === "today" ? date : undefined} close={() => { setNewTask(false); router.push(href({ task: undefined })); }} />}
    </div>
    {editingList !== null && <section className="tm-list-settings task-create-panel"><div className="tm-toolbar"><h2>{t("Configurar lista")}</h2><button className="auth-text-button" type="button" onClick={() => setEditingList(null)}>{t("Cerrar")}</button></div>
      <form className="task-form" key={editingList} onSubmit={(e) => {
        e.preventDefault(); const form = new FormData(e.currentTarget);
        run(() => saveManagedList({ id: editingList, name: form.get("name"), description: form.get("description"),
          folderId: form.get("folderId") || null, icon: form.get("icon"), color: form.get("color"),
          defaultSort: form.get("defaultSort"), defaultView: form.get("defaultView"), showCompleted: form.has("showCompleted"), showDetails: form.has("showDetails") }), () => setEditingList(null));
      }}>
        <label>{t("Nombre")}<input name="name" required maxLength={120} defaultValue={selectedList?.name} /></label>
        <label>{t("Descripción")}<textarea name="description" maxLength={2000} defaultValue={selectedList?.description} /></label>
        <label>{t("Carpeta")}<select name="folderId" defaultValue={selectedList?.folderId ?? ""}><option value="">{t("Sin carpeta")}</option>{options.folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        <label>{t("Icono")}<select name="icon" defaultValue={selectedList?.icon}>{Object.keys(icons).map((icon) => <option key={icon}>{icon}</option>)}</select></label>
        <label>{t("Tono monocromático")}<select name="color" defaultValue={selectedList?.color}>{["neutral", "black", "gray", "white"].map((color) => <option key={color}>{color}</option>)}</select></label>
        <label>{t("Orden predeterminado")}<select name="defaultSort" defaultValue={selectedList?.defaultSort}>{Object.entries(TASK_SORT_LABELS).map(([sort, label]) => <option key={sort} value={sort}>{t(label)}</option>)}</select></label>
        <label>{t("Vista predeterminada")}<select name="defaultView" defaultValue={selectedList?.defaultView}>{Object.entries(TASK_VIEW_LABELS).filter(([v]) => ["standard", "compact", "detailed", "board"].includes(v)).map(([v, label]) => <option key={v} value={v}>{t(label)}</option>)}</select></label>
        <label><input type="checkbox" name="showCompleted" defaultChecked={selectedList?.showCompleted} /> {t("Mostrar completadas")}</label>
        <label><input type="checkbox" name="showDetails" defaultChecked={selectedList?.showDetails} /> {t("Mostrar detalles")}</label>
        <button className="auth-submit" disabled={pending}>{t("Guardar cambios")}</button>
      </form>
      <div className="tm-toolbar">
        {options.lists.map((l, index) => l.id === editingList && index > 0 ? <button className="auth-text-button" key={l.id} disabled={pending} type="button" onClick={() => run(async () => {
          const previous = options.lists[index - 1];
          return manageOrganization({ kind: "list", action: "swap", id: l.id, otherId: previous.id });
        })}>{t("Subir lista")}</button> : null)}
        {(["duplicate", "archive", "delete"] as const).map((action) => <button key={action} className="auth-text-button" disabled={pending} type="button" onClick={() => {
          if (action !== "delete" || confirm(t("Eliminar lista conservando las tareas"))) run(() => manageOrganization({ kind: "list", action, id: editingList }), () => setEditingList(null));
        }}>{t({ duplicate: "Duplicar lista", archive: "Archivar lista", delete: "Eliminar lista" }[action])}</button>)}
      </div>
    </section>}
  </div>;
}
