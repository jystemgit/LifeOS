import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  cookie: undefined as string | undefined, set: vi.fn(), remove: vi.fn(), upsert: vi.fn(), findUnique: vi.fn(),
  exchange: vi.fn(), subject: vi.fn(), owner: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => mocks.cookie ? { value: mocks.cookie } : undefined, set: mocks.set, delete: mocks.remove }) }));
vi.mock("@/lib/require-owner", () => ({ requireOwnerId: mocks.owner }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ googleCalendarConnection: { upsert: mocks.upsert, findUnique: mocks.findUnique } }) }));
vi.mock("@/lib/google-calendar", () => ({
  googleConfig: () => ({ clientId: "fixture-client", redirectUri: "http://localhost:3001/api/integrations/google/callback" }),
  GOOGLE_SCOPES: "openid https://www.googleapis.com/auth/calendar.app.created",
  exchangeGoogle: mocks.exchange, googleSubject: mocks.subject,
}));
import { sealIntegration, openIntegration } from "./integration-tokens";
import { GET as connect } from "@/app/api/integrations/google/connect/route";
import { GET as callback } from "@/app/api/integrations/google/callback/route";

beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("BETTER_AUTH_SECRET", "fixture-google-oauth-encryption-secret");
  mocks.cookie = undefined; mocks.owner.mockResolvedValue("owner");
  mocks.findUnique.mockResolvedValue(null);
  mocks.exchange.mockResolvedValue({ access_token: "fixture-access", refresh_token: "fixture-refresh" });
  mocks.subject.mockResolvedValue("google-subject");
});
afterEach(() => vi.unstubAllEnvs());
const stateCookie = (update = {}) => sealIntegration("google", JSON.stringify({ userId: "owner", state: "state", verifier: "verifier", expiresAt: Date.now() + 600000, ...update }));
describe("Google authorization code flow", () => {
  it("uses PKCE, offline consent and an encrypted, owner-bound HttpOnly state cookie", async () => {
    const response = await connect(), url = new URL(response.headers.get("location")!);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(mocks.set.mock.calls[0][2]).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/api/integrations/google", maxAge: 600 });
    const state = JSON.parse(openIntegration("google", mocks.set.mock.calls[0][1]));
    expect(state.userId).toBe("owner"); expect(state.state).toBe(url.searchParams.get("state"));
    expect(state.verifier).toHaveLength(64);
  });
  it.each([{ state: "wrong" }, { expiresAt: 0 }, { userId: "another-owner" }])("rejects invalid OAuth state before exchanging credentials", async (update) => {
    mocks.cookie = stateCookie(update);
    const response = await callback(new Request("http://localhost:3001/api/integrations/google/callback?state=state&code=code"));
    expect(response.headers.get("location")).toContain("googleError");
    expect(mocks.exchange).not.toHaveBeenCalled(); expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalled();
  });
  it("encrypts refresh tokens and preserves the existing calendar binding", async () => {
    mocks.cookie = stateCookie();
    mocks.findUnique.mockResolvedValue({ subject: "google-subject", calendarId: "existing" });
    const response = await callback(new Request("http://localhost:3001/api/integrations/google/callback?state=state&code=code"));
    expect(response.headers.get("location")).toBe("http://localhost:3001/tasks");
    const data = mocks.upsert.mock.calls[0][0];
    expect(data.update).not.toHaveProperty("calendarId");
    expect(data.update.refreshToken).not.toContain("fixture-refresh");
    expect(openIntegration("google", data.update.refreshToken)).toBe("fixture-refresh");
    expect(mocks.exchange).toHaveBeenCalledWith({ grant_type: "authorization_code", code: "code", code_verifier: "verifier" });
  });
  it("rejects reconnecting a different account and missing offline credentials", async () => {
    mocks.cookie = stateCookie();
    mocks.findUnique.mockResolvedValue({ subject: "original-account" });
    const different = await callback(new Request("http://localhost:3001/api/integrations/google/callback?state=state&code=code"));
    expect(different.headers.get("location")).toContain("googleError");
    expect(mocks.upsert).not.toHaveBeenCalled();
    mocks.findUnique.mockResolvedValue(null);
    mocks.exchange.mockResolvedValue({ access_token: "fixture-access" });
    const missing = await callback(new Request("http://localhost:3001/api/integrations/google/callback?state=state&code=code"));
    expect(missing.headers.get("location")).toContain("googleError");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
