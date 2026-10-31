"use client";
import { useLanguage } from "@/components/language-provider";
import { useState, useSyncExternalStore, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { Moon, Sun } from "lucide-react";

type Theme = "system" | "light" | "dark";

const themeChangeEvent = "lifeos-theme-change";

function isTheme(value: string | null): value is Theme {
  return value === "system" || value === "light" || value === "dark";
}

export function ThemeToggle() {
  const { t } = useLanguage();
  const [animating, setAnimating] = useState(false);
  const theme = useSyncExternalStore(
    (onChange) => {
      window.addEventListener(themeChangeEvent, onChange);
      window.addEventListener("storage", onChange);
      return () => {
        window.removeEventListener(themeChangeEvent, onChange);
        window.removeEventListener("storage", onChange);
      };
    },
    () => {
      try {
        const savedTheme = window.localStorage.getItem("lifeos-theme");
        return isTheme(savedTheme) ? savedTheme : "system";
      } catch {
        return "system";
      }
    },
    (): Theme => "system",
  );

  const systemDark = useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    () => false,
  );
  const dark = theme === "dark" || (theme === "system" && systemDark);
  const nextTheme = dark ? "light" : "dark";
  const label = `${t("Cambiar a")} ${t(dark ? "claro" : "oscuro")}`;

  function toggleTheme(event: MouseEvent<HTMLButtonElement>) {
    const root = document.documentElement;
    const applyTheme = () => {
      root.dataset.theme = nextTheme;
      window.localStorage.setItem("lifeos-theme", nextTheme);
      window.dispatchEvent(new Event(themeChangeEvent));
    };

    if (
      !document.startViewTransition ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      applyTheme();
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const x = bounds.left + bounds.width / 2;
    const y = bounds.top + bounds.height / 2;
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );
    root.style.setProperty("--theme-origin-x", `${x}px`);
    root.style.setProperty("--theme-origin-y", `${y}px`);
    root.style.setProperty("--theme-reveal-radius", `${radius}px`);
    root.dataset.themeTransition = "eclipse";
    const transition = document.startViewTransition(() => {
      flushSync(() => {
        setAnimating(true);
        applyTheme();
      });
    });
    void transition.finished
      .catch((error: unknown) => {
        console.error("Theme transition interrupted", error);
      })
      .finally(() => {
        delete root.dataset.themeTransition;
        root.style.removeProperty("--theme-origin-x");
        root.style.removeProperty("--theme-origin-y");
        root.style.removeProperty("--theme-reveal-radius");
        setAnimating(false);
      });
  }

  return (
    <button
      className="theme-toggle"
      onClick={toggleTheme}
      type="button"
      disabled={animating}
      aria-label={label}
      aria-pressed={dark}
      title={label}
    >
      <span className="theme-thumb" aria-hidden="true">
        {dark ? <Moon size={17} strokeWidth={1.7} /> : <Sun size={17} strokeWidth={1.7} />}
      </span>
      <span className={`theme-icon${!dark ? " theme-icon-active" : ""}`}>
        <Sun size={17} strokeWidth={1.7} aria-hidden="true" />
      </span>
      <span className={`theme-icon${dark ? " theme-icon-active" : ""}`}>
        <Moon size={17} strokeWidth={1.7} aria-hidden="true" />
      </span>
    </button>
  );
}
