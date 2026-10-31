import type { Metadata } from "next";
import { LanguageProvider } from "@/components/language-provider";
import { getLocale } from "@/lib/locale";
import { LOCALE_DETAILS } from "@/domain/locales";
import "./globals.css";

export const instant = false;

const themeBootstrap = `try {
  const savedTheme = localStorage.getItem("lifeos-theme");
  document.documentElement.dataset.theme =
    savedTheme === "light" || savedTheme === "dark" ? savedTheme : "system";
} catch {
  document.documentElement.dataset.theme = "system";
}`;

export const metadata: Metadata = {
  title: "LIFE OS — Augusto Valmont",
  description:
    "La infraestructura personal de Augusto Valmont para una vida diseñada con intención",
  applicationName: "LIFE OS",
  robots: { index: false, follow: false, nocache: true },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  return (
    <html
      lang={LOCALE_DETAILS[locale].html}
      data-theme="system"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body><LanguageProvider locale={locale}>{children}</LanguageProvider></body>
    </html>
  );
}
