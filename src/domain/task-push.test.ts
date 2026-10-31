import { describe, expect, it } from "vitest";
import { isBrowserPushEndpoint, pushRetryDelay, pushSubscriptionSchema } from "./task-push";

describe("browser push endpoint and retry policy", () => {
  it("allows known browser push services, not arbitrary URLs or credential-bearing endpoints", () => {
    for (const endpoint of ["https://fcm.googleapis.com/fcm/send/id", "https://updates.push.services.mozilla.com/wpush/v2/id",
      "https://web.push.apple.com/id", "https://wns2.notify.windows.com/id"]) expect(isBrowserPushEndpoint(endpoint)).toBe(true);
    for (const endpoint of ["http://fcm.googleapis.com/id", "https://localhost/id", "https://127.0.0.1/id",
      "https://fcm.googleapis.com.attacker.invalid/id", "https://user:password@fcm.googleapis.com/id", "https://fcm.googleapis.com:444/id",
      "https://fcm.googleapis.com/id#fragment", "not a URL", "https://notify.windows.com.attacker.invalid/id"])
      expect(isBrowserPushEndpoint(endpoint), endpoint).toBe(false);
  });
  it("validates subscription keys, expiration bounds and interface locale without silently truncating", () => {
    const subscription = { endpoint: "https://fcm.googleapis.com/id", publicKey: "B".repeat(87),
      keys: { p256dh: "A".repeat(87), auth: "a".repeat(22) } };
    expect(pushSubscriptionSchema.parse(subscription)).toMatchObject({ locale: "es", expirationTime: null });
    expect(pushSubscriptionSchema.safeParse({ ...subscription, expirationTime: -1 }).success).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ ...subscription, expirationTime: 8640000000000001 }).success).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ ...subscription, locale: "de" }).success).toBe(false);
    expect(pushSubscriptionSchema.safeParse({ ...subscription, keys: { ...subscription.keys, auth: "short" } }).success).toBe(false);
  });
  it("backs off exponentially and respects Retry-After seconds/date within a bounded maximum", () => {
    const now = new Date("2026-10-30T12:00:00Z");
    expect(pushRetryDelay(1, undefined, now)).toBe(30000);
    expect(pushRetryDelay(3, undefined, now)).toBe(120000);
    expect(pushRetryDelay(1, "120", now)).toBe(120000);
    expect(pushRetryDelay(1, "Fri, 30 Oct 2026 12:05:00 GMT", now)).toBe(300000);
    expect(pushRetryDelay(1, "nonsense", now)).toBe(30000);
    expect(pushRetryDelay(1, "-5", now)).toBe(30000);
    expect(pushRetryDelay(5, "999999999", now)).toBe(86400000);
  });
});
