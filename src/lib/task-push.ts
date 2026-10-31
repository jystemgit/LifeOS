import { createECDH, createHash, ECDH, randomUUID } from "node:crypto";
import webPush from "web-push";
import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import { isBrowserPushEndpoint, pushEndpointSchema, pushRetryDelay, pushSubscriptionSchema, type PushStatus } from "@/domain/task-push";
import { resolveLocale } from "@/domain/locales";

const WORKER_ID = "task-reminders";
const MAX_ATTEMPTS = 5;
const queued = ["PENDING", "RETRY"] as const;
export class TaskPushError extends Error {}

export function taskPushConfiguration() {
  const enabled = process.env.TASK_PUSH_ENABLED === "true";
  const publicKey = process.env.TASK_PUSH_VAPID_PUBLIC_KEY, privateKey = process.env.TASK_PUSH_VAPID_PRIVATE_KEY;
  const subject = process.env.TASK_PUSH_VAPID_SUBJECT;
  if (!enabled) return { configured: false as const, configurationError: false };
  try {
    if (!publicKey || !privateKey || !subject || !/^[A-Za-z0-9_-]{87}$/.test(publicKey) || !/^[A-Za-z0-9_-]{43}$/.test(privateKey))
      throw new TaskPushError("Invalid VAPID configuration");
    const url = new URL(subject);
    if (!(url.protocol === "mailto:" && /^[^@\s]+@[^@\s]+$/.test(url.pathname) ||
      url.protocol === "https:" && !url.username && !url.password)) throw new TaskPushError("Invalid VAPID subject");
    const pair = createECDH("prime256v1");
    pair.setPrivateKey(Buffer.from(privateKey, "base64url"));
    if (pair.getPublicKey().toString("base64url") !== publicKey) throw new TaskPushError("VAPID key mismatch");
    return { configured: true as const, configurationError: false, publicKey, privateKey, subject };
  } catch {
    return { configured: false as const, configurationError: true };
  }
}

export async function readTaskPushStatus(db: PrismaClient, userId: string, endpoint?: string, now = new Date()): Promise<PushStatus> {
  const config = taskPushConfiguration();
  const [worker, subscription, failedDeliveries] = await Promise.all([
    db.taskPushWorkerState.findUnique({ where: { id: WORKER_ID } }),
    endpoint ? db.taskPushSubscription.findFirst({ where: { userId, endpoint } }) : null,
    db.taskPushDelivery.count({ where: { userId, status: "FAILED" } }),
  ]);
  const expired = !!subscription?.expiresAt && subscription.expiresAt <= now;
  const keyChanged = !!subscription && config.configured && subscription.vapidPublicKey !== config.publicKey;
  return {
    configured: config.configured, configurationError: config.configurationError,
    publicKey: config.configured ? config.publicKey : null,
    workerReady: config.configured && !!worker?.lastSuccessAt && now.getTime() - worker.lastSuccessAt.getTime() < 180000 && !worker.lastError,
    workerError: !!worker?.lastError, lastRunAt: worker?.lastStartedAt?.toISOString() ?? null, failedDeliveries,
    subscription: subscription ? { active: !subscription.revokedAt && !expired && !keyChanged, expired,
      failed: !!subscription.lastError, keyChanged } : null,
  };
}

export async function saveTaskPushSubscription(db: PrismaClient, userId: string, raw: unknown, now = new Date()) {
  const input = pushSubscriptionSchema.parse(raw), config = taskPushConfiguration();
  if (!config.configured) throw new TaskPushError("Configura el envío push en el servidor antes de activar");
  if (input.publicKey !== config.publicKey) throw new TaskPushError("La clave push cambió Actualiza y vuelve a activar");
  if (input.expirationTime !== null && input.expirationTime <= now.getTime())
    throw new TaskPushError("La suscripción venció Vuelve a activar las notificaciones");
  try { ECDH.convertKey(Buffer.from(input.keys.p256dh, "base64url"), "prime256v1"); }
  catch { throw new TaskPushError("La suscripción push no es válida"); }
  return db.$transaction(async (tx) => {
    const subscriptionLock = createHash("sha256").update(input.endpoint).digest("hex");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`task-push:${subscriptionLock}`}, 0))`;
    const existing = await tx.taskPushSubscription.findUnique({ where: { endpoint: input.endpoint } });
    if (existing && existing.userId !== userId) throw new TaskPushError("La suscripción pertenece a otra sesión Desactiva este dispositivo antes de continuar");
    const data = { p256dh: input.keys.p256dh, auth: input.keys.auth, locale: input.locale,
      vapidPublicKey: config.publicKey, expiresAt: input.expirationTime === null ? null : new Date(input.expirationTime),
      revokedAt: null, lastError: null };
    if (existing) await tx.taskPushSubscription.update({ where: { id: existing.id, userId }, data });
    else await tx.taskPushSubscription.create({ data: { ...data, userId, endpoint: input.endpoint } });
  });
}

export async function revokeTaskPushSubscription(db: PrismaClient, userId: string, raw: unknown, now = new Date()) {
  const { endpoint } = pushEndpointSchema.parse(raw);
  await db.$transaction(async (tx) => {
    const subscription = await tx.taskPushSubscription.findFirst({ where: { userId, endpoint } });
    if (!subscription) return;
    await tx.taskPushSubscription.update({ where: { id: subscription.id, userId }, data: { revokedAt: now } });
    await tx.taskPushDelivery.updateMany({ where: { subscriptionId: subscription.id, userId, status: { in: [...queued] } },
      data: { status: "CANCELLED", leaseToken: null, lockedUntil: null } });
  });
}

export async function retryFailedTaskPush(db: PrismaClient, userId: string, now = new Date()) {
  await db.taskPushDelivery.updateMany({ where: { userId, status: "FAILED" },
    data: { status: "RETRY", attempts: 0, availableAt: now, leaseToken: null, lockedUntil: null, lastError: null, httpStatus: null } });
}

type Sender = typeof webPush.sendNotification;
type WorkerOptions = { send?: Sender; now?: () => Date };
function dueTask(task: { reminderAt: Date | null; reminderAcknowledgedAt: Date | null; status: string; deletedAt: Date | null; archivedAt: Date | null;
  list: { archivedAt: Date | null } | null }, reminderAt: Date, now: Date) {
  return !task.deletedAt && !task.archivedAt && !task.list?.archivedAt && !["COMPLETED", "CANCELLED"].includes(task.status) &&
    task.reminderAt?.getTime() === reminderAt.getTime() && reminderAt <= now && task.reminderAcknowledgedAt?.getTime() !== reminderAt.getTime();
}
const messages = {
  es: "Tienes un recordatorio pendiente Abre LIFE OS para revisarlo",
  en: "You have a pending reminder Open LIFE OS to review it",
  it: "Hai un promemoria in sospeso Apri LIFE OS per consultarlo",
  fr: "Vous avez un rappel en attente Ouvrez LIFE OS pour le consulter",
};

async function seedDeliveries(tx: Prisma.TransactionClient, now: Date, publicKey: string) {
  await tx.taskPushSubscription.updateMany({ where: { revokedAt: null, expiresAt: { lte: now } },
    data: { revokedAt: now, lastError: "Subscription expired" } });
  await tx.taskPushSubscription.updateMany({ where: { revokedAt: null, vapidPublicKey: { not: publicKey } },
    data: { revokedAt: now, lastError: "VAPID key changed" } });
  // The unique task/instant/device key makes both overlapping runs and retries idempotent.
  await tx.$executeRaw`
    INSERT INTO "TaskPushDelivery" (id, "userId", "taskId", "subscriptionId", "reminderAt", "updatedAt", "availableAt")
    SELECT gen_random_uuid()::text, t."userId", t.id, s.id, t."reminderAt", ${now}, ${now}
    FROM "Task" t JOIN "TaskPushSubscription" s ON s."userId" = t."userId"
    LEFT JOIN "TaskList" l ON l.id = t."listId" AND l."userId" = t."userId"
    WHERE t."deletedAt" IS NULL AND t."archivedAt" IS NULL AND l."archivedAt" IS NULL
      AND t.status NOT IN ('COMPLETED', 'CANCELLED') AND t."reminderAt" <= ${now}
      AND (t."reminderAcknowledgedAt" IS NULL OR t."reminderAcknowledgedAt" <> t."reminderAt")
      AND s."revokedAt" IS NULL AND s."vapidPublicKey" = ${publicKey}
      AND (s."expiresAt" IS NULL OR s."expiresAt" > ${now})
    ON CONFLICT ("taskId", "reminderAt", "subscriptionId") DO NOTHING
  `;
}

export async function deliverTaskPushReminders(db: PrismaClient, options: WorkerOptions = {}) {
  const clock = options.now ?? (() => new Date()), send = options.send ?? webPush.sendNotification;
  const token = randomUUID(), started = clock();
  await db.taskPushWorkerState.upsert({ where: { id: WORKER_ID }, create: { id: WORKER_ID }, update: {} });
  const claim = await db.taskPushWorkerState.updateMany({ where: { id: WORKER_ID,
    OR: [{ lockedUntil: null }, { lockedUntil: { lt: started } }] }, data: {
    lastStartedAt: started, lockedUntil: new Date(started.getTime() + 120000), leaseToken: token,
  } });
  if (!claim.count) throw new TaskPushError("Another reminder worker is running");
  const summary = { accepted: 0, retried: 0, failed: 0, cancelled: 0 };
  try {
    const config = taskPushConfiguration();
    if (!config.configured) throw new TaskPushError("Background push is disabled or its VAPID configuration is invalid");
    await db.$transaction((tx) => seedDeliveries(tx, clock(), config.publicKey));
    const deliveries = await db.taskPushDelivery.findMany({ where: { status: { in: [...queued] }, availableAt: { lte: clock() },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: clock() } }] }, orderBy: [{ reminderAt: "asc" }, { id: "asc" }], take: 100 });
    for (const delivery of deliveries) {
      const now = clock();
      const renewed = await db.taskPushWorkerState.updateMany({ where: { id: WORKER_ID, leaseToken: token, lockedUntil: { gt: now } },
        data: { lockedUntil: new Date(now.getTime() + 120000) } });
      if (!renewed.count) throw new TaskPushError("Reminder worker lost its lease");
      const claimed = await db.taskPushDelivery.updateMany({ where: { id: delivery.id, status: { in: [...queued] }, attempts: delivery.attempts,
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, data: { leaseToken: token, lockedUntil: new Date(now.getTime() + 120000) } });
      if (!claimed.count) continue;
      const current = await db.taskPushDelivery.findUniqueOrThrow({ where: { id: delivery.id }, include: { task: { include: { list: true } }, subscription: true } });
      const sub = current.subscription;
      const save = async (data: Prisma.TaskPushDeliveryUpdateManyMutationInput) => {
        const result = await db.taskPushDelivery.updateMany({
          where: { id: delivery.id, leaseToken: token, lockedUntil: { gt: clock() } },
          data: { ...data, lockedUntil: null, leaseToken: null },
        });
        if (!result.count) throw new TaskPushError("Reminder delivery lease changed Stop and retry from persisted delivery state");
      };
      if (!dueTask(current.task, delivery.reminderAt, now) || sub.revokedAt || sub.expiresAt && sub.expiresAt <= now ||
        sub.vapidPublicKey !== config.publicKey || !isBrowserPushEndpoint(sub.endpoint)) {
        await save({ status: "CANCELLED" }); summary.cancelled++; continue;
      }
      if (current.attempts >= MAX_ATTEMPTS) {
        await save({ status: "FAILED", lastError: "Attempt limit reached after interrupted delivery" }); summary.failed++; continue;
      }
      const attempt = current.attempts + 1;
      await db.taskPushDelivery.updateMany({ where: { id: delivery.id, leaseToken: token }, data: { attempts: attempt } });
      const tag = createHash("sha256").update(delivery.id).digest("base64url").slice(0, 32);
      let result: webPush.SendResult;
      try {
        result = await send({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title: "LIFE OS", body: messages[resolveLocale(sub.locale)], tag,
            url: `/tasks?task=${encodeURIComponent(delivery.taskId)}` }),
          { vapidDetails: { publicKey: config.publicKey, privateKey: config.privateKey, subject: config.subject },
            TTL: 3600, urgency: "normal", topic: tag, contentEncoding: "aes128gcm", timeout: 15000 });
        if (result.statusCode < 200 || result.statusCode >= 300) throw new webPush.WebPushError("Push rejected", result.statusCode, result.headers, "", "");
      } catch (error) {
        const status = error instanceof webPush.WebPushError ? error.statusCode : null;
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : null;
        const retryable = status === 429 || status !== null && status >= 500 ||
          code !== null && ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EPIPE"].includes(code) ||
          error instanceof Error && error.message === "Socket timeout";
        if (status === 404 || status === 410) {
          await db.taskPushSubscription.update({ where: { id: sub.id }, data: { revokedAt: clock(), lastError: `Push endpoint expired (${status})` } });
          await save({ status: "CANCELLED", lastError: `Push endpoint expired (${status})`, httpStatus: status });
          summary.cancelled++;
        } else if (retryable && attempt < MAX_ATTEMPTS) {
          const header = error instanceof webPush.WebPushError ? error.headers["retry-after"] : undefined;
          const retryAfter = typeof header === "string" ? header : undefined;
          await save({ status: "RETRY", availableAt: new Date(clock().getTime() + pushRetryDelay(attempt, retryAfter, clock())),
            lastError: status ? `Push service temporarily unavailable (${status})` : "Push network failure", httpStatus: status });
          summary.retried++;
        } else if (status !== null || retryable) {
          await save({ status: "FAILED", lastError: status ? `Push service rejected delivery (${status})` : "Push network retry limit reached", httpStatus: status });
          summary.failed++;
          console.error("Task push delivery failed", { deliveryId: delivery.id, status, attempt });
        } else {
          await save({ status: "FAILED", lastError: "Unexpected push transport failure" });
          throw new TaskPushError("Unexpected push transport failure Check worker configuration and subscriptions");
        }
        continue;
      }
      await save({ status: "ACCEPTED", acceptedAt: clock(), lastError: null, httpStatus: result.statusCode });
      summary.accepted++;
    }
    const finished = await db.taskPushWorkerState.updateMany({ where: { id: WORKER_ID, leaseToken: token, lockedUntil: { gt: clock() } }, data: {
      lastSuccessAt: clock(), lastError: summary.failed ? "Some push deliveries failed Inspect reminder status" : null,
    } });
    if (!finished.count) throw new TaskPushError("Reminder worker lost its lease before completion");
    return summary;
  } catch (error) {
    await db.taskPushWorkerState.updateMany({ where: { id: WORKER_ID, leaseToken: token },
      data: { lastError: error instanceof TaskPushError ? error.message : "Reminder worker failed Inspect server logs without exposing subscription keys" } });
    throw error;
  } finally {
    await db.taskPushWorkerState.updateMany({ where: { id: WORKER_ID, leaseToken: token }, data: { lockedUntil: null, leaseToken: null } });
  }
}
