import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

/**
 * Petr 2026-06-18 redesign — Gide-on theme toggle.
 *
 * Bootstrap v Base.astro nastaví `<html data-theme>` z localStorage před
 * renderem (proti flash). Tato komponenta jen toggluje + persistuje.
 *
 * Storage klíč: `gide-on-theme` = "light" | "dark" | nic (default dark)
 */

type Theme = "light" | "dark";

function getInitialTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "light" ? "light" : "dark";
}

export default function ThemeToggle({ size = "default" }: { size?: "default" | "compact" }) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(getInitialTheme());
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("gide-on-theme", next);
    } catch {
      /* private mode, ignore */
    }
  }

  const isDark = theme === "dark";
  const label = isDark ? "Přepnout na světlý režim" : "Přepnout na tmavý režim";

  if (size === "compact") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        title={label}
        className="size-9 rounded-md grid place-items-center hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
      >
        {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border text-sm hover:bg-secondary transition-colors"
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      <span>{isDark ? "Světlý" : "Tmavý"}</span>
    </button>
  );
}
