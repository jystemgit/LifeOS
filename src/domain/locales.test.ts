import { describe, expect, it } from "vitest";
import { isLocale, LOCALES, LOCALE_DETAILS, resolveLocale } from "./locales";
import { translate, translations } from "./translations";

describe("language preferences", () => {
  it("supports the reference sites' four languages in the same order", () => {
    expect(LOCALES.map((locale) => LOCALE_DETAILS[locale].label))
      .toEqual(["Spanish", "English", "Italian", "French"]);
    expect(LOCALES.map((locale) => LOCALE_DETAILS[locale].html))
      .toEqual(["es-AR", "en-US", "it-IT", "fr-FR"]);
  });

  it("uses an explicitly saved supported language", () => {
    expect(resolveLocale("it")).toBe("it");
    expect(isLocale("de")).toBe(false);
    expect(isLocale(null)).toBe(false);
  });

  it("starts in Spanish like the reference sites and rejects invalid stored values", () => {
    expect(resolveLocale(undefined)).toBe("es");
    expect(resolveLocale(null)).toBe("es");
    expect(resolveLocale("invalid")).toBe("es");
  });
});

describe("first-party interface translations", () => {
  it("provides complete nonempty translations for every catalog entry", () => {
    for (const [source, entry] of Object.entries(translations)) {
      expect(source.trim().length).toBeGreaterThan(0);
      expect(entry).toHaveLength(3);
      for (const text of entry) expect(text.trim().length).toBeGreaterThan(0);
    }
  });

  it("translates login text in all four languages without terminal periods", () => {
    expect(LOCALES.map((locale) => translate("Ingresar a LIFE OS", locale)))
      .toEqual(["Ingresar a LIFE OS", "Sign in to LIFE OS", "Accedi a LIFE OS", "Se connecter à LIFE OS"]);
  });

  it("preserves surrounding spacing and leaves unknown data unchanged", () => {
    expect(translate("  Correo electrónico ", "en")).toBe("  Email address ");
    expect(translate("My private journal entry.", "fr")).toBe("My private journal entry.");
    expect(translate("augusto.valmont.av@gmail.com", "it")).toBe("augusto.valmont.av@gmail.com");
    expect(translate("https://augustovalmont.com", "en")).toBe("https://augustovalmont.com");
  });
});
