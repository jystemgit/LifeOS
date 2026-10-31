import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCALES, LOCALE_COOKIE } from "@/domain/locales";

const mocks = vi.hoisted(() => ({ setCookie: vi.fn(), refresh: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: mocks.setCookie }),
}));
vi.mock("next/cache", () => ({ refresh: mocks.refresh }));

import { setLanguage } from "./actions";

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe("saving a language preference", () => {
  it.each(LOCALES)("persists %s for a year and refreshes the current route", async (locale) => {
    await setLanguage(locale);
    expect(mocks.setCookie).toHaveBeenCalledWith(LOCALE_COOKIE, locale, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 31_536_000,
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("uses a secure cookie in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await setLanguage("fr");
    expect(mocks.setCookie).toHaveBeenCalledWith(
      LOCALE_COOKIE, "fr", expect.objectContaining({ secure: true }),
    );
  });

  it("rejects unsupported values instead of saving an invalid preference", async () => {
    await expect(setLanguage("de")).rejects.toThrow("Unsupported language");
    expect(mocks.setCookie).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("surfaces persistence errors rather than reporting success", async () => {
    mocks.setCookie.mockImplementationOnce(() => { throw new Error("Cookie write failed"); });
    await expect(setLanguage("it")).rejects.toThrow("Cookie write failed");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
