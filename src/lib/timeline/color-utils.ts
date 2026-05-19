/**
 * Color utility funkce pro Timeline View (F1).
 *
 * Petr 2026-05-19 — viz design_tokens.md § 1.1 + § 7.3.
 * Q-F = B: bez Contact.displayColor migrace, jen hash(id) → paleta.
 */

import type { Theme } from "../../components/timeline/types";

/** Per-osoba paleta z design_tokens.md § 1.1. 8 slotů (overflow cyklem). */
export const PERSON_PALETTE: { light: string; dark: string; name: string }[] = [
  { light: "#E89B6F", dark: "#F4B485", name: "warm peach" },
  { light: "#7FB5DB", dark: "#9FCBE6", name: "soft sky" },
  { light: "#8FC7B8", dark: "#A8D6C8", name: "mint" },
  { light: "#E6A6B4", dark: "#EFC0CB", name: "dusty rose" },
  { light: "#B6A4D9", dark: "#C9B8E2", name: "lilac" },
  { light: "#A6C99A", dark: "#BFD6B3", name: "sage" },
  { light: "#D9B58A", dark: "#E6CBA5", name: "sand" },
  { light: "#9FB8C9", dark: "#B5CADB", name: "stone" },
];

/** Semantic colors z design_tokens.md § 1.3. */
export const SEMANTIC = {
  today: { light: "#D97766", dark: "#E89380" },
  milestone: { light: "#E8C45F", dark: "#F0CF73" },
  milestoneCheck: { light: "#5A4520", dark: "#3A2810" },
};

/** Stabilní hash → index do palety (0..size-1). */
export function hashToColorIndex(input: string, paletteSize = PERSON_PALETTE.length): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % paletteSize;
}

/** Vrátí HEX barvu palety per theme. */
export function paletteColor(index: number, theme: Theme): string {
  const slot = PERSON_PALETTE[index % PERSON_PALETTE.length]!;
  return theme === "dark" ? slot.dark : slot.light;
}

/** HEX → rgba s alpha. */
export function hexA(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Ztmaví barvu o `amount` (0..1). */
export function darken(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const f = 1 - Math.max(0, Math.min(1, amount));
  return rgbToHex(Math.round(r * f), Math.round(g * f), Math.round(b * f));
}

/** Zesvětlí barvu o `amount` (0..1). */
export function lighten(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  const a = Math.max(0, Math.min(1, amount));
  return rgbToHex(
    Math.round(r + (255 - r) * a),
    Math.round(g + (255 - g) * a),
    Math.round(b + (255 - b) * a),
  );
}

/** Task text color per theme (design_tokens.md § 7.3). */
export function taskTitleColor(subColor: string, theme: Theme): string {
  return theme === "light" ? darken(subColor, 0.5) : lighten(subColor, 0.4);
}

export function taskMetaColor(subColor: string, theme: Theme): string {
  return theme === "light" ? darken(subColor, 0.3) : lighten(subColor, 0.2);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const bigint = parseInt(full, 16);
  return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
