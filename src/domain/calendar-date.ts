export function getCalendarDate(
  timeZone: string,
  instant = new Date(),
): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) {
    throw new Error(`Unable to determine the calendar date for time zone ${timeZone}.`);
  }
  return `${year}-${month}-${day}`;
}

export function getISOWeekday(date: string): number {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new Error("A valid YYYY-MM-DD date is required.");
  }
  const day = parsed.getUTCDay();
  return day === 0 ? 7 : day;
}
