/**
 * Theme detection + persist (light/dark) — Petr Q-A: A (vlastní theme).
 *
 * Klíč v localStorage: `raseliniste.timelineView.theme` (namespaced).
 * Default: dark (Rašeliniště je dark-only, klient může toggle na light).
 *
 * Modul NEZASAHUJE do globálního Rašeliniště theme — funguje samostatně
 * jako "ostrov" s data-theme atributem na svém root.
 */

import type { Theme } from "../../components/timeline/types";

const STORAGE_KEY = "raseliniste.timelineView.theme";

export function detectInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage může být blokovaný (private mode, atd.)
  }
  // OS preference fallback
  if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) return "dark";
  return "dark"; // default Rašeliniště-stylové dark
}

export function persistTheme(theme: Theme): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore
  }
}

export function hasUserOverride(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark";
  } catch {
    return false;
  }
}
