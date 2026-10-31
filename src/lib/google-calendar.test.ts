import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { GoogleCalendarClient, googleConfig, googleEventId } from "./google-calendar";
import { openIntegration, sealIntegration } from "./integration-tokens";

afterEach(() => vi.unstubAllEnvs());
describe("Google Calendar transport and credential boundary", () => {
  it("requires actual configuration and separates provider encryption keys", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", ""); vi.stubEnv("GOOGLE_CLIENT_SECRET", ""); vi.stubEnv("GOOGLE_REDIRECT_URI", "");
    expect(() => googleConfig()).toThrow("Configura");
    vi.stubEnv("BETTER_AUTH_SECRET", "fixture-only-secret-not-for-production");
    const encrypted = sealIntegration("google", "refresh");
    expect(openIntegration("google", encrypted)).toBe("refresh");
    expect(() => openIntegration("microsoft", encrypted)).toThrow();
    expect(() => openIntegration("google", "short")).toThrow();
  });
  it("uses provider-valid deterministic IDs without exposing task IDs", () => {
    expect(googleEventId("private-task")).toMatch(/^[a-v0-9]{64}$/);
    expect(googleEventId("private-task")).toBe(googleEventId("private-task"));
    expect(googleEventId("private-task", "restored")).not.toBe(googleEventId("private-task"));
  });
  it("restricts hosts and redirects, paginates and rejects loops", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ items: [1], nextPageToken: "second" }))
      .mockResolvedValueOnce(Response.json({ items: [2] }));
    const client = new GoogleCalendarClient("fixture", request);
    expect(await client.collection("calendars/calendar/events")).toEqual([1, 2]);
    expect(String(request.mock.calls[1][0])).toContain("pageToken=second");
    expect(request.mock.calls[0][1]?.redirect).toBe("error");
    await expect(client.call("https://example.invalid/steal")).rejects.toThrow("Untrusted");
    request.mockImplementation(async () => Response.json({ nextPageToken: "repeat" }));
    await expect(client.collection("users/me/calendarList")).rejects.toThrow("loop");
  });
  it("enforces etags, reports throttling and makes repeated deletion safe", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 412 }))
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "30" } }))
      .mockResolvedValueOnce(new Response(null, { status: 410 }));
    const client = new GoogleCalendarClient("fixture", request);
    await expect(client.call("calendars/c/events/e", "PATCH", {}, '"etag"')).rejects.toThrow("412");
    expect(request.mock.calls[0][1]?.headers).toHaveProperty("If-Match", '"etag"');
    await expect(client.call("calendars/c/events")).rejects.toThrow("30");
    await expect(client.call("calendars/c/events/gone", "DELETE")).resolves.toBeNull();
  });
});
