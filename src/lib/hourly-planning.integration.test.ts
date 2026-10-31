import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { emptyHours } from "@/domain/hourly-planning";
import { publishHourlyPlan, readHourlyPlan, readTodayHourlyPlan } from "./hourly-planning";
import { persistManagedTask, readManagedTasks } from "./task-management";

const mocks = vi.hoisted(() => ({ db: null as PrismaClient | null, owner: "" }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => mocks.db! }));
vi.mock("@/lib/require-owner", () => ({ requireOwnerId: async () => mocks.owner }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { revalidatePath } from "next/cache";
import { publishDailyPlan } from "@/app/planning/day/actions";
import { manageTasks } from "@/app/tasks/manage-actions";

const databaseUrl = process.env.DAILY_PLANNING_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("hourly planning PostgreSQL publication", () => {
  let db: PrismaClient;
  const userId = `hourly-${randomUUID()}`, otherId = `hourly-other-${randomUUID()}`;
  const date = "2030-10-30";
  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl!, options: "-c timezone=UTC" }) });
    mocks.db = db; mocks.owner = userId;
    await db.user.createMany({ data: [userId, otherId].map((id) => ({ id, name: "Hourly acceptance", email: `${id}@example.invalid` })) });
  });
  afterAll(async () => {
    if (!db) return;
    await db.dailyPlan.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    await db.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await db.$disconnect();
  });
  it("publishes, reads after reconnect and replaces all 24 entries including removals", async () => {
    const hours = emptyHours(); hours[6] = "Wake"; hours[9] = "Study"; hours[20] = "Read";
    expect(await readHourlyPlan(db, userId, date)).toBeNull();
    const result = await publishDailyPlan({ date, hours });
    expect(result.plan?.hours).toEqual(hours);
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(revalidatePath).toHaveBeenCalledWith("/planning/day");
    const reopened = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl!, options: "-c timezone=UTC" }) });
    try { expect(await readHourlyPlan(reopened, userId, date)).toEqual({ date, hours }); }
    finally { await reopened.$disconnect(); }
    const draft = [...hours]; draft[6] = ""; draft[9] = "Revised"; draft[12] = "Lunch";
    expect((await readHourlyPlan(db, userId, date))?.hours).toEqual(hours);
    await publishHourlyPlan(db, userId, { date, hours: draft });
    expect((await readHourlyPlan(db, userId, date))?.hours).toEqual(draft);
    expect(await db.dailyPlan.count({ where: { userId } })).toBe(1);
    const stored = await db.dailyPlan.findFirstOrThrow({ where: { userId } });
    expect(stored).not.toHaveProperty("version");
    expect(stored).not.toHaveProperty("notes");
    expect(await db.taskActivityHistory.count({ where: { userId } })).toBe(0);
    await publishHourlyPlan(db, userId, { date, hours: emptyHours() });
    expect((await readHourlyPlan(db, userId, date))?.hours).toEqual(emptyHours());
  });
  it("isolates owners/dates, rejects invalid input and reads local midnight without writes or carry-forward", async () => {
    const hours = emptyHours(); hours[0] = "Owner local midnight";
    await publishHourlyPlan(db, userId, { date, hours });
    const before = await db.dailyPlan.findFirstOrThrow({ where: { userId } });
    expect(await readHourlyPlan(db, otherId, date)).toBeNull();
    expect(await readTodayHourlyPlan(db, userId, new Date("2030-10-31T02:59:59Z"))).toEqual({ date, plan: { date, hours } });
    expect(await readTodayHourlyPlan(db, userId, new Date("2030-10-31T03:00:00Z"))).toEqual({ date: "2030-10-31", plan: null });
    const invalid = await publishDailyPlan({ date, hours: ["Incomplete"] });
    expect(invalid.error).toBeTruthy();
    expect(await db.dailyPlan.findFirstOrThrow({ where: { userId } })).toEqual(before);
    expect(await db.dailyPlan.count({ where: { userId } })).toBe(1);
    await expect(db.dailyPlan.update({ where: { id: before.id }, data: { publishedHours: ["Invalid"] } })).rejects.toThrow();
    await expect(db.dailyPlan.update({ where: { id: before.id }, data: { publishedHours: Array(24).fill(1) } })).rejects.toThrow();
  });
  it("serializes concurrent complete replacements without duplicates or mixed entries", async () => {
    const a = emptyHours().map(() => "A"), b = emptyHours().map(() => "B");
    for (const selectedDate of [date, "2030-10-29"]) {
      await Promise.all([publishHourlyPlan(db, userId, { date: selectedDate, hours: a }), publishHourlyPlan(db, userId, { date: selectedDate, hours: b })]);
      const plan = await readHourlyPlan(db, userId, selectedDate);
      expect([a, b]).toContainEqual(plan?.hours);
      expect(await db.dailyPlan.count({ where: { userId, date: new Date(`${selectedDate}T00:00:00Z`) } })).toBe(1);
    }
  });
  it("preserves the prior publication if a database update fails", async () => {
    const rollbackDate = "2030-11-02";
    const original = emptyHours(); original[9] = "Preserve on failure";
    await publishHourlyPlan(db, userId, { date: rollbackDate, hours: original });
    const stored = await db.dailyPlan.findUniqueOrThrow({ where: { userId_date: { userId, date: new Date(`${rollbackDate}T00:00:00Z`) } } });
    const suffix = randomUUID().replaceAll("-", "");
    const fn = `hourly_failure_${suffix}`;
    await db.$executeRawUnsafe(`CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD."id" = '${stored.id}' THEN RAISE EXCEPTION 'Injected hourly replacement failure'; END IF; RETURN NEW; END; $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER "${fn}" BEFORE UPDATE ON "DailyPlan" FOR EACH ROW EXECUTE FUNCTION "${fn}"()`);
    try {
      await expect(publishHourlyPlan(db, userId, { date: rollbackDate, hours: emptyHours() })).rejects.toThrow();
      expect(await readHourlyPlan(db, userId, rollbackDate)).toEqual({ date: rollbackDate, hours: original });
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER "${fn}" ON "DailyPlan"`);
      await db.$executeRawUnsafe(`DROP FUNCTION "${fn}"()`);
    }
  });
  it("does not let task creation, scheduling, completion, recurrence or deletion change the published sheet", async () => {
    const before = await readHourlyPlan(db, userId, date);
    const taskId = await persistManagedTask(db, userId, { title: "Independent task", scheduledDate: date, startTime: "08:00", endTime: "09:00",
      recurrence: { frequency: "DAILY", interval: 1, startDate: date } });
    const task = (await readManagedTasks(db, userId)).find((task) => task.id === taskId)!;
    await persistManagedTask(db, userId, { ...task, startTime: "10:00", endTime: "11:00" });
    expect(await manageTasks({ ids: [taskId], action: "complete" })).toEqual({ saved: true });
    expect(await manageTasks({ ids: [taskId], action: "delete" })).toEqual({ saved: true });
    expect(await readHourlyPlan(db, userId, date)).toEqual(before);
  });
});
