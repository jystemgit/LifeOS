import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TaskPushSettings } from "./task-push-settings";
import { waitForPushWorker } from "@/domain/task-push";
import { LanguageProvider } from "./language-provider";

describe("push activation and initial presentation", () => {
  afterEach(() => vi.useRealTimers());
  it("does not imply browser/server support or request permission during initial rendering", () => {
    const markup = renderToStaticMarkup(<LanguageProvider locale="en"><TaskPushSettings /></LanguageProvider>);
    expect(markup).toContain("Optional push notifications");
    expect(markup).toContain("browser permission");
    expect(markup).toContain("disabled");
    expect(markup).not.toContain("Push active on this device");
  });
  it("rejects registrations with no active/installing worker instead of hanging forever", async () => {
    await expect(waitForPushWorker({ active: null, installing: null, waiting: null })).rejects.toThrow("no pudo activar");
  });
  it("accepts an activated worker and bounds activation waits", async () => {
    const worker = { state: "activated" as ServiceWorkerState, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    await expect(waitForPushWorker({ active: worker, installing: null, waiting: null })).resolves.toBeUndefined();
    vi.useFakeTimers();
    worker.state = "installing";
    const waiting = expect(waitForPushWorker({ active: null, installing: worker, waiting: null })).rejects.toThrow("no pudo activar");
    await vi.advanceTimersByTimeAsync(10000); await waiting;
    expect(worker.removeEventListener).toHaveBeenCalledWith("statechange", expect.any(Function));
  });
});
