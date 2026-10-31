"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Check, ChevronDown, Globe } from "lucide-react";
import { setLanguage } from "@/app/language/actions";
import { LOCALES, LOCALE_DETAILS } from "@/domain/locales";
import { useLanguage } from "@/components/language-provider";

export function LanguageSelector() {
  const { locale, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const requestedFocus = useRef<number | null>(null);
  const id = useId();
  const label = LOCALE_DETAILS[locale].change;

  function focusItem(index: number) {
    menu.current?.querySelectorAll("button")[index]?.focus();
  }

  useEffect(() => {
    if (open && requestedFocus.current !== null) {
      focusItem(requestedFocus.current);
      requestedFocus.current = null;
    }
  }, [open]);

  useEffect(() => {
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);

  return (
    <div
      className="language-selector"
      ref={container}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        className="language-trigger"
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-busy={pending}
        disabled={pending}
        ref={trigger}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const index = event.key === "ArrowDown" ? 0 : LOCALES.length - 1;
            if (open) focusItem(index);
            else {
              requestedFocus.current = index;
              setOpen(true);
            }
          }
        }}
      >
        <Globe aria-hidden="true" size={16} />
        <span lang="en">{LOCALE_DETAILS[locale].label}</span>
        <ChevronDown className={`language-chevron${open ? " is-open" : ""}`} aria-hidden="true" size={16} />
      </button>
      <div
        className={`language-menu${open ? " is-open" : ""}`}
        id={id}
        role="menu"
        aria-label={label}
        inert={!open}
        ref={menu}
        onKeyDown={(event) => {
          const buttons = [...(menu.current?.querySelectorAll("button") ?? [])];
          const index = buttons.findIndex((button) => button === event.target);
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            focusItem((index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length);
          } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            focusItem(event.key === "Home" ? 0 : buttons.length - 1);
          }
        }}
      >
        {LOCALES.map((value) => (
          <button
            key={value}
            role="menuitemradio"
            aria-checked={locale === value}
            type="button"
            lang="en"
            onClick={() => {
              setOpen(false);
              trigger.current?.focus();
              if (value === locale) return;
              setFailed(false);
              startTransition(async () => {
                try {
                  await setLanguage(value);
                } catch (error) {
                  console.error("Language preference could not be saved", error);
                  setFailed(true);
                }
              });
            }}
          >
            <span>{LOCALE_DETAILS[value].label}</span>
            {locale === value && <Check aria-hidden="true" size={16} />}
          </button>
        ))}
      </div>
      {pending && <span className="sr-only" role="status">{t("Cambiando idioma")}</span>}
      {failed && <p className="language-error" role="alert">{t("No se pudo guardar el idioma Inténtalo otra vez")}</p>}
    </div>
  );
}
