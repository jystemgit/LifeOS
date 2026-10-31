import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { GraphClient, sealMicrosoft, openMicrosoft, microsoftConfig, microsoftAccount } from "./microsoft-todo";

afterEach(() => vi.unstubAllEnvs());
describe("private Microsoft connector", () => {
  it("encrypts refresh tokens with authenticated encryption and rejects tampering", () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "test-only-integration-key-not-a-production-secret");
    const encrypted = sealMicrosoft("test-refresh-token");
    expect(encrypted).not.toContain("test-refresh-token");
    expect(openMicrosoft(encrypted)).toBe("test-refresh-token");
    const tampered = Buffer.from(encrypted, "base64url"); tampered[13] ^= 1;
    expect(() => openMicrosoft(tampered.toString("base64url"))).toThrow();
  });
  it("requires actual Entra configuration", () => {
    vi.stubEnv("MICROSOFT_CLIENT_ID", ""); vi.stubEnv("MICROSOFT_CLIENT_SECRET", ""); vi.stubEnv("MICROSOFT_REDIRECT_URI", "");
    expect(() => microsoftConfig()).toThrow("Configura");
  });
  it("reads only the authenticated account ID and rejects an unidentifiable response", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ id: "original-account" })).mockResolvedValueOnce(Response.json({ displayName: "Not an account ID" }));
    const client = new GraphClient("fixture-access-token", request);
    expect(await microsoftAccount(client)).toBe("original-account");
    expect(String(request.mock.calls[0][0])).toBe("https://graph.microsoft.com/v1.0/me?$select=id");
    expect(request.mock.calls[0][1]?.redirect).toBe("error");
    await expect(microsoftAccount(client)).rejects.toThrow();
  });
  it("follows pagination only on Microsoft Graph and detects loops", async () => {
    const request = vi.fn<typeof fetch>();
    request.mockResolvedValueOnce(Response.json({ value: [{ id: "1" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/todo/lists?$skip=1" }))
      .mockResolvedValueOnce(Response.json({ value: [{ id: "2" }] }));
    const client = new GraphClient("fixture-access-token", request);
    expect(await client.collection("me/todo/lists")).toEqual([{ id: "1" }, { id: "2" }]);
    await expect(client.call("https://example.invalid/steal")).rejects.toThrow("Untrusted");
    expect(request).toHaveBeenCalledTimes(2);
    request.mockResolvedValue(Response.json({ value: [], "@odata.nextLink": "me/todo/lists" }));
    await expect(client.collection("me/todo/lists")).rejects.toThrow("loop");
  });
  it("surfaces throttling and failed writes without returning success", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 429, headers: { "Retry-After": "30" } }));
    await expect(new GraphClient("fixture", request).call("me/todo/lists", "POST", { displayName: "Fixture" })).rejects.toThrow("30 segundos");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("allows retrying an already-applied deletion without hiding missing reads", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
    const client = new GraphClient("fixture", request);
    await expect(client.call("me/todo/lists/deleted", "DELETE")).resolves.toBeNull();
    await expect(client.call("me/todo/lists/deleted")).rejects.toThrow("ya no existe");
  });
});
