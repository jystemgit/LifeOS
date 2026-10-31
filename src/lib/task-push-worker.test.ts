import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

type WorkerEvent = { waitUntil: (promise: Promise<void>) => void; data?: { json: () => unknown };
  notification?: { close: () => void; data: { url: string } } };
function worker() {
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const showNotification = vi.fn(), openWindow = vi.fn(), navigate = vi.fn(), focus = vi.fn();
  const skipWaiting = vi.fn().mockResolvedValue(undefined), claim = vi.fn().mockResolvedValue(undefined);
  const matchAll = vi.fn().mockResolvedValue([{ url: "https://lifeos.example/tasks", navigate, focus }]);
  runInNewContext(readFileSync("public/task-reminders-sw.js", "utf8"), {
    URL, self: { addEventListener: (type: string, callback: (event: WorkerEvent) => void) => listeners.set(type, callback),
      skipWaiting, registration: { showNotification }, location: { origin: "https://lifeos.example" }, clients: { matchAll, openWindow, claim } },
  });
  async function dispatch(type: string, data: unknown) {
    let result: Promise<void> | undefined;
    listeners.get(type)!({ waitUntil: (promise) => { result = promise; }, data: { json: () => data },
      notification: { close: vi.fn(), data: { url: typeof data === "string" ? data : "" } } });
    await result;
  }
  return { listeners, showNotification, openWindow, navigate, focus, matchAll, dispatch, skipWaiting, claim };
}
describe("background reminder service worker", () => {
  const payload = { title: "LIFE OS", body: "You have a pending reminder", tag: "A".repeat(32), url: "/tasks?task=fixture-task" };
  it("activates updates without caching private pages or waiting for another open task tab to close", async () => {
    const sw = worker();
    await sw.dispatch("install", null); await sw.dispatch("activate", null);
    expect(sw.skipWaiting).toHaveBeenCalledOnce(); expect(sw.claim).toHaveBeenCalledOnce();
    expect(sw.listeners.has("fetch")).toBe(false);
  });
  it("displays generic reminders with a stable replacement tag and no renotification", async () => {
    const sw = worker();
    await sw.dispatch("push", payload); await sw.dispatch("push", payload);
    expect(sw.showNotification).toHaveBeenCalledWith("LIFE OS", expect.objectContaining({
      body: payload.body, tag: payload.tag, renotify: false, data: { url: payload.url },
    }));
    expect(sw.listeners.has("fetch")).toBe(false);
  });
  it("rejects untrusted destinations and malformed payloads instead of displaying success-shaped notifications", async () => {
    const sw = worker();
    await expect(sw.dispatch("push", { ...payload, url: "https://untrusted.invalid/" })).rejects.toThrow("Invalid");
    await expect(sw.dispatch("push", { ...payload, tag: "bad" })).rejects.toThrow("Invalid");
    await expect(sw.dispatch("push", null)).rejects.toThrow("Invalid");
    expect(sw.showNotification).not.toHaveBeenCalled();
  });
  it("opens only the linked native task and focuses an existing same-origin window", async () => {
    const sw = worker();
    await sw.dispatch("notificationclick", payload.url);
    expect(sw.navigate).toHaveBeenCalledWith("https://lifeos.example/tasks?task=fixture-task");
    expect(sw.focus).toHaveBeenCalled(); expect(sw.openWindow).not.toHaveBeenCalled();
    sw.matchAll.mockResolvedValue([]);
    await sw.dispatch("notificationclick", payload.url);
    expect(sw.openWindow).toHaveBeenCalledWith("https://lifeos.example/tasks?task=fixture-task");
    await expect(sw.dispatch("notificationclick", "//untrusted.invalid/")).rejects.toThrow("Invalid");
  });
});
