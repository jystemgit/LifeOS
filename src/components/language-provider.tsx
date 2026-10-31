"use client";

import { createContext, useContext, type ReactNode } from "react";
import { LOCALE_DETAILS, type Locale } from "@/domain/locales";
import { translate } from "@/domain/translations";

const LanguageContext = createContext<Locale>("es");

export function LanguageProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LanguageContext.Provider value={locale}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const locale = useContext(LanguageContext);
  return { locale, t: (text: string) => translate(text, locale) };
}

export function LocalizedText({ children }: { children: string }) {
  const { t } = useLanguage();
  return t(children);
}

export function LocalizedDate({
  value,
  options = { dateStyle: "long", timeZone: "UTC" },
}: {
  value: Date | string;
  options?: Intl.DateTimeFormatOptions;
}) {
  const { locale } = useLanguage();
  const date = typeof value === "string" ? new Date(`${value}T12:00:00.000Z`) : value;
  return new Intl.DateTimeFormat(LOCALE_DETAILS[locale].html, options).format(date);
}

export function LocalizedNumber({ value, options }: { value: number; options?: Intl.NumberFormatOptions }) {
  const { locale } = useLanguage();
  return new Intl.NumberFormat(LOCALE_DETAILS[locale].html, options).format(value);
}
