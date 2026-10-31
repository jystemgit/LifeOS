import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookie: undefined as string | undefined, set: vi.fn(), remove: vi.fn(), findUnique: vi.fn(),
  create: vi.fn(), updateMany: vi.fn(), listCount: vi.fn(), taskCount: vi.fn(), exchange: vi.fn(), account: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => mocks.cookie ? { value: mocks.cookie } : undefined, set: mocks.set, delete: mocks.remove }) }));
vi.mock("@/lib/require-owner", () => ({ requireOwnerId: async () => "owner" }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({
  microsoftConnection: { findUnique: mocks.findUnique, create: mocks.create, updateMany: mocks.updateMany },
  taskListSynchronizationRecord: { count: mocks.listCount }, taskSynchronizationRecord: { count: mocks.taskCount },
}) }));
vi.mock("@/lib/microsoft-todo", async (importOriginal) => ({
  ...await importOriginal<typeof import("./microsoft-todo")>(),
  exchangeMicrosoft: mocks.exchange, microsoftAccount: mocks.account,
}));
import { openMicrosoft, sealMicrosoft, MICROSOFT_SCOPES } from "./microsoft-todo";
import { GET as connect } from "@/app/api/integrations/microsoft/connect/route";
import { GET as callback } from "@/app/api/integrations/microsoft/callback/route";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("BETTER_AUTH_SECRET", "fixture-microsoft-oauth-encryption-secret");
  vi.stubEnv("MICROSOFT_CLIENT_ID", "fixture-client");
  vi.stubEnv("MICROSOFT_CLIENT_SECRET", "fixture-client-secret");
  vi.stubEnv("MICROSOFT_REDIRECT_URI", "http://localhost:3001/api/integrations/microsoft/callback");
  vi.stubEnv("MICROSOFT_TENANT_ID", "common");
  mocks.cookie = undefined;
  mocks.findUnique.mockResolvedValue(null);
  mocks.listCount.mockResolvedValue(0); mocks.taskCount.mockResolvedValue(0);
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.exchange.mockResolvedValue({ access_token: "fixture-access", refresh_token: "fixture-refresh" });
  mocks.account.mockResolvedValue("original-account");
});
afterEach(() => vi.unstubAllEnvs());
const stateCookie = (update = {}) => sealMicrosoft(JSON.stringify({ userId: "owner", state: "state", verifier: "verifier", expiresAt: Date.now() + 600000, ...update }));
const authorize = () => callback(new Request("http://localhost:3001/api/integrations/microsoft/callback?state=state&code=code"));

describe("Microsoft authorization and durable account binding", () => {
  it("uses PKCE and an encrypted, owner-bound HttpOnly state cookie", async () => {
    const response = await connect(), url = new URL(response.headers.get("location")!);
    expect(url.origin).toBe("https://login.microsoftonline.com");
    expect(url.searchParams.get("scope")).toBe(MICROSOFT_SCOPES);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(mocks.set.mock.calls[0][2]).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/api/integrations/microsoft", maxAge: 600 });
    const state = JSON.parse(openMicrosoft(mocks.set.mock.calls[0][1]));
    expect(state.userId).toBe("owner"); expect(state.state).toBe(url.searchParams.get("state")); expect(state.verifier).toHaveLength(64);
  });
  it.each([{ state: "wrong" }, { expiresAt: 0 }, { userId: "another-owner" }])("rejects invalid OAuth state before exchanging credentials", async (update) => {
    mocks.cookie = stateCookie(update);
    expect((await authorize()).headers.get("location")).toContain("microsoftError");
    expect(mocks.exchange).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.remove).toHaveBeenCalled();
  });
  it("binds a first authorization to its verified Graph account and encrypts the refresh token", async () => {
    mocks.cookie = stateCookie();
    expect((await authorize()).headers.get("location")).toBe("http://localhost:3001/tasks");
    const { data } = mocks.create.mock.calls[0][0];
    expect(data).toMatchObject({ userId: "owner", accountId: "original-account" });
    expect(data.refreshToken).not.toContain("fixture-refresh"); expect(openMicrosoft(data.refreshToken)).toBe("fixture-refresh");
  });
  it("reconnects the original account with a conditional token write and invalidates the old lease", async () => {
    mocks.cookie = stateCookie();
    mocks.findUnique.mockResolvedValue({ accountId: "original-account", refreshToken: "" });
    expect((await authorize()).headers.get("location")).toBe("http://localhost:3001/tasks");
    expect(mocks.updateMany.mock.calls[0][0]).toMatchObject({
      where: { userId: "owner", accountId: "original-account", refreshToken: "" }, data: { lockedUntil: null, error: null },
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects a different account without replacing credentials", async () => {
    mocks.cookie = stateCookie();
    mocks.findUnique.mockResolvedValue({ accountId: "original-account", refreshToken: "unchanged" });
    mocks.account.mockResolvedValue("different-account");
    expect((await authorize()).headers.get("location")).toContain("microsoftError");
    expect(mocks.updateMany).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("migrates a legacy connection only after verifying its original refresh token account", async () => {
    mocks.cookie = stateCookie();
    mocks.findUnique.mockResolvedValue({ accountId: null, refreshToken: sealMicrosoft("legacy-refresh") });
    expect((await authorize()).headers.get("location")).toBe("http://localhost:3001/tasks");
    expect(mocks.exchange).toHaveBeenNthCalledWith(2, { grant_type: "refresh_token", refresh_token: "legacy-refresh", scope: MICROSOFT_SCOPES });
    expect(mocks.updateMany).toHaveBeenCalledTimes(2);
    expect(mocks.updateMany.mock.calls[0][0].data.accountId).toBe("original-account");
  });
  it("preserves the original binding when a legacy connection is reauthorized with a different account", async () => {
    mocks.cookie = stateCookie();
    mocks.findUnique.mockResolvedValue({ accountId: null, refreshToken: sealMicrosoft("legacy-refresh") });
    mocks.account.mockResolvedValueOnce("different-account").mockResolvedValueOnce("original-account");
    expect((await authorize()).headers.get("location")).toContain("microsoftError");
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany.mock.calls[0][0].data.accountId).toBe("original-account");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not adopt orphaned legacy mappings or overwrite a concurrent reconnect", async () => {
    mocks.cookie = stateCookie(); mocks.listCount.mockResolvedValue(1);
    expect((await authorize()).headers.get("location")).toContain("microsoftError");
    expect(mocks.create).not.toHaveBeenCalled();
    mocks.findUnique.mockResolvedValue({ accountId: "original-account", refreshToken: "old-encrypted-token" });
    mocks.updateMany.mockResolvedValue({ count: 0 });
    expect((await authorize()).headers.get("location")).toContain("microsoftError");
  });
  it("requires offline credentials and does not replace an unverifiable legacy binding", async () => {
    mocks.cookie = stateCookie();
    mocks.exchange.mockResolvedValueOnce({ access_token: "fixture-access" });
    expect((await authorize()).headers.get("location")).toContain("microsoftError");
    expect(mocks.account).not.toHaveBeenCalled();
    mocks.findUnique.mockResolvedValue({ accountId: null, refreshToken: "" });
    expect((await authorize()).headers.get("location")).toContain("microsoftError");
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
