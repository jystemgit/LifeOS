import { z } from "zod";
import { getCalendarDate } from "./calendar-date";

export const OWNER_TIME_ZONE = "America/Argentina/Buenos_Aires";

export const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return value >= "0001-01-01" && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Selecciona una fecha válida");

export function minuteLabel(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export function timeMinute(time: string): number {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) && time !== "24:00") throw new Error("Hora inválida");
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}

export function shiftDate(date: string, days: number): string {
  calendarDateSchema.parse(date);
  const instant = new Date(`${date}T12:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

export function localMinute(instant: Date, timeZone = OWNER_TIME_ZONE): number {
  const parts = new Intl.DateTimeFormat("en", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant);
  return Number(parts.find((p) => p.type === "hour")?.value) * 60 + Number(parts.find((p) => p.type === "minute")?.value);
}

export function zonedDateTime(value: string, timeZone = OWNER_TIME_ZONE): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Fecha y hora inválidas");
  calendarDateSchema.parse(value.slice(0, 10));
  timeMinute(value.slice(11));
  const desired = Date.parse(`${value}:00Z`);
  let guess = desired;
  for (let i = 0; i < 4; i++) {
    const instant = new Date(guess);
    const localDate = getCalendarDate(timeZone, instant);
    const localTime = minuteLabel(localMinute(instant, timeZone));
    const difference = desired - Date.parse(`${localDate}T${localTime}:00Z`);
    if (!difference) return instant.toISOString();
    guess += difference;
  }
  throw new Error("La hora no existe en la zona horaria configurada");
}
