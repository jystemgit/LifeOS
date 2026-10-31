import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: null as { user: { id: string; twoFactorEnabled: boolean } } | null,
  read: vi.fn(), save: vi.fn(), revoke: vi.fn(), retry: vi.fn(), db: {} }));
vi.mock("@/lib/auth-session", () => ({ getAuthSession: async () => mocks.session }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => mocks.db }));
vi.mock("@/lib/task-push", async (original) => ({ ...await original<typeof import("@/lib/task-push")>(),
  readTaskPushStatus: mocks.read, saveTaskPushSubscription: mocks.save, revokeTaskPushSubscription: mocks.revoke, retryFailedTaskPush: mocks.retry }));
import { GET, POST } from "./route";

describe("owner-authenticated push subscription API", () => {
  const endpoint = "https://fcm.googleapis.com/fcm/send/fixture";
  const request = (body: unknown, origin = "http://localhost:3001") => new Request("http://localhost:3001/api/tasks/push", {
    method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body),
  });
  beforeEach(() => {
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3001");
    vi.clearAllMocks(); mocks.session = { user: { id: "fixture-owner", twoFactorEnabled: true } };
    mocks.read.mockResolvedValue({ configured: false, publicKey: null });
  });
  afterEach(() => vi.unstubAllEnvs());
  it("requires sign-in and completed 2FA for reads and all writes", async () => {
    mocks.session = null;
    expect((await GET()).status).toBe(401);
    expect((await POST(request({ action: "revoke", endpoint }))).status).toBe(401);
    mocks.session = { user: { id: "fixture-owner", twoFactorEnabled: false } };
    expect((await GET()).status).toBe(401);
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it("does not cache status or expose another user's subscription", async () => {
    const response = await GET();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.read).toHaveBeenCalledWith(mocks.db, "fixture-owner");
    await POST(request({ action: "status", endpoint, userId: "another-owner" }));
    expect(mocks.read).toHaveBeenLastCalledWith(mocks.db, "fixture-owner", endpoint);
  });
  it("rejects cross-origin writes, arbitrary endpoints, oversized and malformed JSON", async () => {
    expect((await POST(request({ action: "revoke", endpoint }, "https://untrusted.invalid"))).status).toBe(403);
    expect((await POST(request({ action: "revoke", endpoint: "https://127.0.0.1/private" }))).status).toBe(400);
    expect((await POST(request({ action: "revoke", endpoint, padding: "A".repeat(9000) }))).status).toBe(413);
    expect((await POST(new Request("http://localhost:3001/api/tasks/push", { method: "POST",
      headers: { origin: "http://localhost:3001", "content-type": "application/json" }, body: "{" }))).status).toBe(400);
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it("persists only validated subscriptions for the authenticated owner and supports explicit revoke/retry", async () => {
    const subscription = { endpoint, publicKey: "B".repeat(87), keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) } };
    expect((await POST(request({ action: "subscribe", subscription }))).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith(mocks.db, "fixture-owner", expect.objectContaining({ endpoint, locale: "es" }));
    await POST(request({ action: "revoke", endpoint }));
    expect(mocks.revoke).toHaveBeenCalledWith(mocks.db, "fixture-owner", expect.objectContaining({ endpoint }));
    await POST(request({ action: "retry" }));
    expect(mocks.retry).toHaveBeenCalledWith(mocks.db, "fixture-owner");
  });
});
