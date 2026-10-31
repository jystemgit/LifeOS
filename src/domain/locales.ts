export const LOCALES = ["es", "en", "it", "fr"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_COOKIE = "lifeos-language";
export const LOCALE_DETAILS = {
  es: { label: "Spanish", html: "es-AR", change: "Cambiar idioma" },
  en: { label: "English", html: "en-US", change: "Change language" },
  it: { label: "Italian", html: "it-IT", change: "Cambia lingua" },
  fr: { label: "French", html: "fr-FR", change: "Changer de langue" },
} as const;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && LOCALES.some((locale) => locale === value);
}

export function resolveLocale(saved: unknown): Locale {
  return isLocale(saved) ? saved : "es";
}
