import Link from "next/link";
import { LocalizedDate, LocalizedText } from "@/components/language-provider";
import { filterTasks, taskQuadrant, QUADRANTS, type TaskSummary } from "@/domain/task-management";

export function DailyTasks({ tasks, date }: { tasks: TaskSummary[]; date: string }) {
  const active = filterTasks(tasks, { view: "active" }, date);
  const relevant = [...active].sort((a, b) => {
    const relevantDate = (task: TaskSummary) => task.deadline ?? task.scheduledDate ?? "9999";
    return relevantDate(a).localeCompare(relevantDate(b)) || a.position - b.position;
  }).slice(0, 8);
  return (
    <section className="section" aria-labelledby="command-tasks-title">
      <h2 id="command-tasks-title"><LocalizedText>Tareas activas</LocalizedText></h2>
      {relevant.length ? relevant.map((task) => {
        const q = taskQuadrant(task);
        return <article className="daily-task-row" key={task.id}>
          <div>
            <Link href={`/tasks?task=${task.id}`}>{task.title}</Link>
            <p className="task-item-meta">
              <LocalizedText>{q ? QUADRANTS[q].label : "Sin clasificación"}</LocalizedText>
              {task.deadline && <> · <LocalizedText>Fecha límite</LocalizedText>:{" "}
                <LocalizedDate value={task.deadline} options={{ dateStyle: "short", timeZone: "UTC" }} /></>}
            </p>
          </div>
        </article>;
      }) : <p className="section-note"><LocalizedText>No hay tareas activas</LocalizedText></p>}
      <Link className="auth-text-button" href="/tasks"><LocalizedText>Abrir tareas</LocalizedText></Link>
    </section>
  );
}
