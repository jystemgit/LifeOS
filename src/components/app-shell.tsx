"use client";

import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { CalendarRange, ClipboardCheck, LayoutDashboard, Menu, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { LocalizedText, useLanguage } from "@/components/language-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSelector } from "@/components/language-selector";
import { BrandLogo } from "@/components/brand-logo";
import { TaskReminders } from "@/components/task-reminders";

const primaryLinks = [
  { href: "/", label: "Centro de comando", icon: LayoutDashboard },
  { href: "/planning/day", label: "Planificar mi día", icon: CalendarRange },
  { href: "/tasks", label: "Tareas", icon: ClipboardCheck },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const pathname = usePathname();
  return (
    <div className="app-shell">
      <aside className={`sidebar${mobileNavOpen ? " sidebar-open" : ""}`} id="primary-sidebar">
        <Link className="brand" href="/" aria-label={t("Augusto Valmont Life OS, inicio")}>
          <BrandLogo />
          <span className="brand-name">Augusto Valmont</span>
          <span className="brand-product">LIFE OS</span>
        </Link>
        <div className="sidebar-rule" />
        <p className="nav-label"><LocalizedText>ESPACIO PERSONAL</LocalizedText></p>
        <nav aria-label={t("Navegación principal")}>
          {primaryLinks.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === href : pathname.startsWith(href);
            return <Link key={href} href={href} className={`nav-link${active ? " nav-link-active" : ""}`}
              aria-current={active ? "page" : undefined} onClick={() => setMobileNavOpen(false)}>
              <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
              <span>{t(label)}</span>
            </Link>;
          })}
        </nav>
        <div className="sidebar-rule" />
        <nav aria-label={t("Configuración")}>
          <Link className={`nav-link${pathname === "/security" ? " nav-link-active" : ""}`}
            aria-current={pathname === "/security" ? "page" : undefined}
            href="/security" onClick={() => setMobileNavOpen(false)}>
            <ShieldCheck size={17} strokeWidth={1.7} aria-hidden="true" />
            <span>{t("Cuenta y seguridad")}</span>
          </Link>
        </nav>
      </aside>
      {mobileNavOpen && <button aria-label={t("Cerrar navegación")} className="mobile-backdrop"
        onClick={() => setMobileNavOpen(false)} type="button" />}
      <main className="main-content">
        <TaskReminders />
        <div className="app-language-bar"><LanguageSelector /><ThemeToggle /></div>
        <header className="mobile-header">
          <Link className="mobile-brand" href="/"><BrandLogo /><span>Augusto Valmont</span></Link>
          <button aria-label={t(mobileNavOpen ? "Cerrar navegación" : "Abrir navegación")}
            aria-controls="primary-sidebar" aria-expanded={mobileNavOpen} className="mobile-menu-button"
            onClick={() => setMobileNavOpen((open) => !open)} type="button">
            {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </header>
        <div className="content-wrap">{children}</div>
      </main>
    </div>
  );
}
