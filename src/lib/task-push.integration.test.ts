import { randomBytes, randomUUID, createECDH } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "pg";
import webPush from "web-push";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { deliverTaskPushReminders, readTaskPushStatus, retryFailedTaskPush, revokeTaskPushSubscription, saveTaskPushSubscription, taskPushConfiguration } from "./task-push";

const databaseUrl = process.env.TASK_MANAGEMENT_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("durable task push PostgreSQL delivery", () => {
  let db: PrismaClient, admin: Client, created = false;
  const name = `lifeos_push_${randomUUID().replaceAll("-", "")}`;
  let userId: string, otherId: string, now: Date, keys: ReturnType<typeof webPush.generateVAPIDKeys>;
  const clock = () => now;
  beforeAll(async () => {
    admin = new Client({ connectionString: databaseUrl! }); await admin.connect();
    await admin.query(`CREATE DATABASE "${name}"`); created = true;
    const url = new URL(databaseUrl!); url.pathname = `/${name}`;
    await promisify(execFile)("node", ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: url.href }, timeout: 30000,
    });
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.href, options: "-c timezone=UTC" }) });
  }, 40000);
  beforeEach(async () => {
    userId = `push-owner-${randomUUID()}`; otherId = `push-other-${randomUUID()}`;
    now = new Date("2026-10-30T12:00:00Z"); keys = webPush.generateVAPIDKeys();
    vi.stubEnv("TASK_PUSH_ENABLED", "true"); vi.stubEnv("TASK_PUSH_VAPID_PUBLIC_KEY", keys.publicKey);
    vi.stubEnv("TASK_PUSH_VAPID_PRIVATE_KEY", keys.privateKey); vi.stubEnv("TASK_PUSH_VAPID_SUBJECT", "mailto:fixture@example.invalid");
    await db.user.createMany({ data: [userId, otherId].map((id) => ({ id, name: "Push fixture", email: `${id}@example.invalid` })) });
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await db.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await db.taskPushWorkerState.deleteMany();
  });
  afterAll(async () => {
    await db?.$disconnect();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin?.end();
  });
  async function subscription(owner = userId, expirationTime: number | null = null) {
    const ecdh = createECDH("prime256v1"); ecdh.generateKeys();
    const input = { endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`, expirationTime,
      publicKey: keys.publicKey, locale: "en", keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") } };
    await saveTaskPushSubscription(db, owner, input, now);
    return input;
  }
  const task = (extra: object = {}) => db.task.create({ data: { userId, title: "Private task title must not be sent",
    notes: "Private notes", reminderAt: now, ...extra } });
  const sender = () => vi.fn<typeof webPush.sendNotification>().mockResolvedValue({ statusCode: 201, body: "", headers: {} });

  it("keeps background push opt-in, validates matching keys and reports worker availability honestly", async () => {
    vi.stubEnv("TASK_PUSH_ENABLED", "false");
    expect(taskPushConfiguration()).toMatchObject({ configured: false, configurationError: false });
    await expect(deliverTaskPushReminders(db, { now: clock, send: sender() })).rejects.toThrow("disabled");
    expect(await readTaskPushStatus(db, userId, undefined, now)).toMatchObject({ configured: false, workerReady: false, workerError: true });
    vi.stubEnv("TASK_PUSH_ENABLED", "true");
    vi.stubEnv("TASK_PUSH_VAPID_PRIVATE_KEY", webPush.generateVAPIDKeys().privateKey);
    expect(taskPushConfiguration()).toMatchObject({ configured: false, configurationError: true });
    vi.stubEnv("TASK_PUSH_VAPID_PRIVATE_KEY", keys.privateKey);
    await deliverTaskPushReminders(db, { now: clock, send: sender() });
    expect(await readTaskPushStatus(db, userId, undefined, now)).toMatchObject({ configured: true, workerReady: true, workerError: false });
    now = new Date(now.getTime() + 180001);
    expect((await readTaskPushStatus(db, userId, undefined, now)).workerReady).toBe(false);
  });
  it("persists owner-scoped subscriptions idempotently and rejects hijacking, invalid keys and expired input", async () => {
    const sub = await subscription();
    await Promise.all([saveTaskPushSubscription(db, userId, sub, now), saveTaskPushSubscription(db, userId, sub, now)]);
    expect(await db.taskPushSubscription.count()).toBe(1);
    await expect(saveTaskPushSubscription(db, otherId, sub, now)).rejects.toThrow("otra sesión");
    await expect(saveTaskPushSubscription(db, userId, { ...sub, publicKey: webPush.generateVAPIDKeys().publicKey }, now)).rejects.toThrow("cambió");
    await expect(saveTaskPushSubscription(db, userId, { ...sub, expirationTime: now.getTime() - 1 }, now)).rejects.toThrow("venció");
    await expect(saveTaskPushSubscription(db, userId, { ...sub, keys: { ...sub.keys, p256dh: "A".repeat(87) } }, now)).rejects.toThrow("válida");
    await revokeTaskPushSubscription(db, otherId, sub, now);
    expect((await db.taskPushSubscription.findUniqueOrThrow({ where: { endpoint: sub.endpoint } })).revokedAt).toBeNull();
    expect((await readTaskPushStatus(db, otherId, sub.endpoint, now)).subscription).toBeNull();
  });
  it("sends once per reminder and device using real encrypted Web Push request construction, never personal titles", async () => {
    const first = await subscription(), second = await subscription();
    const original = await task();
    await subscription(otherId);
    await task({ title: "Future", reminderAt: new Date(now.getTime() + 1) });
    await task({ archivedAt: now }); await task({ deletedAt: now }); await task({ status: "COMPLETED" });
    await task({ reminderAcknowledgedAt: now });
    const list = await db.taskList.create({ data: { userId, name: "Archived list", archivedAt: now } });
    await task({ listId: list.id });
    const send = sender().mockImplementation(async (sub, payload, options) => {
      const request = webPush.generateRequestDetails(sub, String(payload), options);
      expect(request.method).toBe("POST");
      expect(request.body.length).toBeGreaterThan(100);
      expect(request.body.toString()).not.toContain("Private");
      expect(payload).not.toContain("Private");
      expect(request.headers.Authorization).toBeDefined();
      expect(options).toMatchObject({ TTL: 3600, contentEncoding: "aes128gcm", timeout: 15000 });
      return { statusCode: 201, body: "", headers: {} };
    });
    expect(await deliverTaskPushReminders(db, { now: clock, send })).toMatchObject({ accepted: 2 });
    await deliverTaskPushReminders(db, { now: clock, send });
    expect(send).toHaveBeenCalledTimes(2);
    expect(new Set(send.mock.calls.map(([sub]) => sub.endpoint))).toEqual(new Set([first.endpoint, second.endpoint]));
    expect(await db.taskPushDelivery.count({ where: { status: "ACCEPTED", taskId: original.id } })).toBe(2);
    expect((await db.task.findUniqueOrThrow({ where: { id: original.id } })).reminderAcknowledgedAt).toBeNull();
    now = new Date(now.getTime() + 1000);
    await db.task.update({ where: { id: original.id }, data: { reminderAt: now } });
    await deliverTaskPushReminders(db, { now: clock, send });
    expect(await db.taskPushDelivery.count({ where: { taskId: original.id } })).toBe(4);
  });
  it("revokes expired endpoints on 404/410 and stops deliveries to expired/revoked subscriptions", async () => {
    const sub = await subscription(), original = await task();
    const send = sender().mockRejectedValue(new webPush.WebPushError("Expired", 410, {}, "sensitive endpoint response", sub.endpoint));
    expect(await deliverTaskPushReminders(db, { now: clock, send })).toMatchObject({ cancelled: 1 });
    expect((await readTaskPushStatus(db, userId, sub.endpoint, now)).subscription).toMatchObject({ active: false, failed: true });
    await deliverTaskPushReminders(db, { now: clock, send });
    expect(send).toHaveBeenCalledTimes(1);
    expect((await db.taskPushDelivery.findFirstOrThrow({ where: { taskId: original.id } })).lastError).not.toContain(sub.endpoint);
    const expires = await subscription(userId, now.getTime() + 1000);
    now = new Date(now.getTime() + 2000);
    await deliverTaskPushReminders(db, { now: clock, send });
    expect((await readTaskPushStatus(db, userId, expires.endpoint, now)).subscription).toMatchObject({ active: false, expired: true });
    expect(send).toHaveBeenCalledTimes(1);
    const another = await subscription();
    send.mockRejectedValueOnce(new webPush.WebPushError("Expired", 404, {}, "", another.endpoint));
    await deliverTaskPushReminders(db, { now: clock, send });
    expect((await db.taskPushSubscription.findUniqueOrThrow({ where: { endpoint: another.endpoint } })).revokedAt).not.toBeNull();
  });
  it("retries 429 and server failures with Retry-After, then accepts once without re-alerting accepted deliveries", async () => {
    const sub = await subscription(); await task();
    const send = sender().mockRejectedValueOnce(new webPush.WebPushError("Rate limited", 429, { "retry-after": "120" }, "", sub.endpoint))
      .mockRejectedValueOnce(new webPush.WebPushError("Unavailable", 503, {}, "", sub.endpoint));
    expect(await deliverTaskPushReminders(db, { now: clock, send })).toMatchObject({ retried: 1 });
    const pending = await db.taskPushDelivery.findFirstOrThrow();
    expect(pending).toMatchObject({ status: "RETRY", attempts: 1, availableAt: new Date(now.getTime() + 120000) });
    await deliverTaskPushReminders(db, { now: clock, send }); expect(send).toHaveBeenCalledTimes(1);
    now = pending.availableAt;
    await deliverTaskPushReminders(db, { now: clock, send });
    now = (await db.taskPushDelivery.findFirstOrThrow()).availableAt;
    await deliverTaskPushReminders(db, { now: clock, send });
    await deliverTaskPushReminders(db, { now: clock, send });
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[0][2]?.topic).toBe(send.mock.calls[2][2]?.topic);
    expect((await db.taskPushDelivery.findFirstOrThrow()).status).toBe("ACCEPTED");
  });
  it("bounds network retry attempts, exposes failures and supports explicit owner-isolated retry", async () => {
    await subscription(); await task();
    const send = sender().mockRejectedValue(Object.assign(new Error("network details must stay private"), { code: "ETIMEDOUT" }));
    for (let attempt = 1; attempt <= 5; attempt++) {
      await deliverTaskPushReminders(db, { now: clock, send });
      const delivery = await db.taskPushDelivery.findFirstOrThrow();
      expect(delivery.attempts).toBe(attempt);
      now = delivery.availableAt;
    }
    expect((await readTaskPushStatus(db, userId, undefined, now)).failedDeliveries).toBe(1);
    await retryFailedTaskPush(db, otherId, now);
    expect((await db.taskPushDelivery.findFirstOrThrow()).status).toBe("FAILED");
    await retryFailedTaskPush(db, userId, now);
    send.mockResolvedValue({ statusCode: 201, body: "", headers: {} });
    await deliverTaskPushReminders(db, { now: clock, send });
    expect((await db.taskPushDelivery.findFirstOrThrow()).status).toBe("ACCEPTED");
    expect((await readTaskPushStatus(db, userId, undefined, now)).failedDeliveries).toBe(0);
  });
  it("does not retry nonretryable authorization failures or hide unexpected transport failures", async () => {
    await subscription(); await task();
    const send = sender().mockRejectedValueOnce(new webPush.WebPushError("Forbidden", 403, {}, "", ""));
    expect(await deliverTaskPushReminders(db, { now: clock, send })).toMatchObject({ failed: 1 });
    await retryFailedTaskPush(db, userId, now);
    send.mockRejectedValueOnce(new Error("Unexpected programming failure"));
    await expect(deliverTaskPushReminders(db, { now: clock, send })).rejects.toThrow("Unexpected push transport failure");
    expect((await readTaskPushStatus(db, userId, undefined, now)).workerError).toBe(true);
  });
  it("cancels retries after acknowledgement, archive, rescheduling or explicit unsubscribe without changing task data", async () => {
    const sub = await subscription(), original = await task();
    const send = sender().mockRejectedValueOnce(Object.assign(new Error("Temporary"), { code: "ECONNRESET" }));
    await deliverTaskPushReminders(db, { now: clock, send });
    now = (await db.taskPushDelivery.findFirstOrThrow()).availableAt;
    await db.task.update({ where: { id: original.id }, data: { reminderAcknowledgedAt: original.reminderAt } });
    await deliverTaskPushReminders(db, { now: clock, send });
    expect((await db.taskPushDelivery.findFirstOrThrow()).status).toBe("CANCELLED");
    expect(send).toHaveBeenCalledTimes(1);
    await db.task.update({ where: { id: original.id }, data: { reminderAt: now, reminderAcknowledgedAt: null } });
    send.mockRejectedValueOnce(new Error("Socket timeout"));
    await deliverTaskPushReminders(db, { now: clock, send });
    const before = await db.task.findUniqueOrThrow({ where: { id: original.id } });
    await revokeTaskPushSubscription(db, userId, sub, now);
    expect(await db.taskPushDelivery.count({ where: { status: { in: ["PENDING", "RETRY"] } } })).toBe(0);
    expect(await db.task.findUniqueOrThrow({ where: { id: original.id } })).toEqual(before);
  });
  it("cancels queued task/list archives and superseded dates, and expires subscriptions after a VAPID rotation", async () => {
    const sub = await subscription();
    const list = await db.taskList.create({ data: { userId, name: "Archive after retry" } });
    const individuallyArchived = await task(), rescheduled = await task();
    await task({ listId: list.id });
    const send = sender().mockRejectedValue(Object.assign(new Error("Temporary"), { code: "ECONNRESET" }));
    await deliverTaskPushReminders(db, { now: clock, send });
    expect(send).toHaveBeenCalledTimes(3);
    await db.task.update({ where: { id: individuallyArchived.id }, data: { archivedAt: now } });
    await db.taskList.update({ where: { id: list.id }, data: { archivedAt: now } });
    await db.task.update({ where: { id: rescheduled.id }, data: { reminderAt: new Date(now.getTime() + 3600000) } });
    now = new Date(now.getTime() + 60000);
    expect(await deliverTaskPushReminders(db, { now: clock, send })).toMatchObject({ cancelled: 3 });
    expect(send).toHaveBeenCalledTimes(3);
    keys = webPush.generateVAPIDKeys();
    vi.stubEnv("TASK_PUSH_VAPID_PUBLIC_KEY", keys.publicKey); vi.stubEnv("TASK_PUSH_VAPID_PRIVATE_KEY", keys.privateKey);
    await deliverTaskPushReminders(db, { now: clock, send });
    expect((await readTaskPushStatus(db, userId, sub.endpoint, now)).subscription).toMatchObject({ active: false, keyChanged: true });
    expect(send).toHaveBeenCalledTimes(3);
  });
  it("serializes concurrent workers and recovers interrupted delivery leases with the same stable identity", async () => {
    await subscription(); await task();
    let release!: () => void, entered!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const send = sender().mockImplementationOnce(async () => { entered(); await waiting; return { statusCode: 201, body: "", headers: {} }; });
    const running = deliverTaskPushReminders(db, { now: clock, send });
    await started;
    try { await expect(deliverTaskPushReminders(db, { now: clock, send })).rejects.toThrow("Another reminder worker"); }
    finally { release(); }
    await running;
    const delivery = await db.taskPushDelivery.findFirstOrThrow();
    await db.taskPushDelivery.update({ where: { id: delivery.id }, data: { status: "RETRY", acceptedAt: null,
      leaseToken: "interrupted", lockedUntil: new Date(now.getTime() - 1) } });
    await db.taskPushWorkerState.update({ where: { id: "task-reminders" }, data: { leaseToken: "interrupted", lockedUntil: new Date(now.getTime() - 1) } });
    await deliverTaskPushReminders(db, { now: clock, send });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][2]?.topic).toBe(send.mock.calls[1][2]?.topic);
    expect(await db.taskPushDelivery.count()).toBe(1);
  });
});
