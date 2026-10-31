import { z } from "zod";
import { LOCALES } from "./locales";

export function isBrowserPushEndpoint(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash && (!url.port || url.port === "443") &&
      (["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"].includes(url.hostname) ||
        url.hostname.endsWith(".notify.windows.com"));
  } catch { return false; }
}

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().max(2048).refine(isBrowserPushEndpoint, "Servicio de notificaciones no compatible"),
  expirationTime: z.number().int().min(0).max(8640000000000000).nullable().default(null),
  keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/) }),
  publicKey: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
  locale: z.enum(LOCALES).default("es"),
});
export const pushEndpointSchema = z.object({ endpoint: pushSubscriptionSchema.shape.endpoint });
export const pushStatusSchema = z.object({
  configured: z.boolean(), configurationError: z.boolean(), publicKey: z.string().nullable(),
  workerReady: z.boolean(), workerError: z.boolean(), lastRunAt: z.string().nullable(),
  subscription: z.object({ active: z.boolean(), expired: z.boolean(), failed: z.boolean(), keyChanged: z.boolean() }).nullable(),
  failedDeliveries: z.number().int().min(0),
});
export type PushStatus = z.infer<typeof pushStatusSchema>;

export async function waitForPushWorker(registration: {
  active: Pick<ServiceWorker, "state" | "addEventListener" | "removeEventListener"> | null;
  installing: Pick<ServiceWorker, "state" | "addEventListener" | "removeEventListener"> | null;
  waiting: Pick<ServiceWorker, "state" | "addEventListener" | "removeEventListener"> | null;
}) {
  const worker = registration.active ?? registration.installing ?? registration.waiting;
  if (!worker) throw new Error("El navegador no pudo activar el servicio push Los avisos en la aplicación siguen activos");
  if (worker.state === "activated") return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => finish(false), 10000);
    const finish = (ready: boolean) => {
      clearTimeout(timer); worker.removeEventListener("statechange", changed);
      if (ready) resolve();
      else reject(new Error("El navegador no pudo activar el servicio push Los avisos en la aplicación siguen activos"));
    };
    const changed = () => {
      if (worker.state === "activated") finish(true);
      else if (worker.state === "redundant") finish(false);
    };
    worker.addEventListener("statechange", changed); changed();
  });
}

export function pushRetryDelay(attempt: number, retryAfter: string | undefined, now: Date): number {
  const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : NaN;
  const parsed = retryAfter ? Date.parse(retryAfter) : NaN;
  const requested = Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(parsed) ? parsed - now.getTime() : 0;
  return Math.min(24 * 60 * 60000, Math.max(Math.min(3600000, 30000 * 2 ** (attempt - 1)), requested));
}
