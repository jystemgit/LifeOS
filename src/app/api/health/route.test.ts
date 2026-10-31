import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn(), end: vi.fn() }));
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("pg", () => ({ Client: class {
  connect = mocks.connect;
  query = mocks.query;
  end = mocks.end;
} }));
import { GET } from "./route";

describe("production readiness", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost/test");
  });
  it("checks migrated storage without exposing records and disables caching", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.end).toHaveBeenCalledOnce();
  });
  it("reports unavailable storage as 503 and logs no credentials or private details", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.connect.mockRejectedValueOnce(new Error("private connection details"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(log).toHaveBeenCalledWith("Readiness check failed: database unavailable or migrations missing");
    expect(mocks.end).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});
