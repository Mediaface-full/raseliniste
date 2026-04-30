/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Sdílený hook pro audio recording stránky (Ozvěna, Studna owner+guest).
 *
 * Co řeší:
 *
 * 1. **Screen Wake Lock** — telefon/desktop se automaticky neuzamkne
 *    během nahrávání. Funguje v Chrome (od 2020), Safari iOS (16.4+),
 *    Safari macOS (16.4+), Firefox (126+), všech Chromium browserech.
 *    Lock se uvolní automaticky při Stop nebo při unmount komponenty.
 *
 * 2. **Visibility change tracking** — pokud uživatel přepne do jiné
 *    aplikace nebo zamkne mobil (manuálně), zaznamenáme čas. Po návratu
 *    můžeme upozornit, že záznam byl pravděpodobně přerušen (iOS Safari
 *    suspenduje JS na pozadí, Android Chrome často pokračuje).
 *
 * 3. **Audio duration sanity check** — po Stop porovnej délku audio
 *    bloku vs. uplynulý čas. Pokud nesedí (např. točil 5 min ale audio
 *    má 30 s), znamená to že nahrávání bylo přerušeno.
 *
 * Použití:
 *
 *   const protection = useRecordingProtection();
 *
 *   // při Start:
 *   protection.start();
 *
 *   // při Stop, po obdržení blob:
 *   const warning = protection.stop(audioBlob, elapsedMs);
 *   if (warning) alert(warning);
 *
 *   // pro UI před nahráváním:
 *   if (!protection.wakeLockSupported) showHint("Stará verze browseru.");
 */

export interface RecordingProtection {
  // Stav (pro UI)
  isActive: boolean;
  wakeLockSupported: boolean;
  wakeLockActive: boolean;
  hiddenDurations: number[]; // celkem ms strávených v background za toto recording

  // Handlery (volat z recorderu)
  start: () => Promise<void>;
  stop: (audioBlob: Blob | null, elapsedMs: number) => string | null; // vrátí varovnou hlášku nebo null
  cancel: () => void; // bez warning, jen uvolnit zdroje
}

interface VisibilityWindow {
  hiddenAt: number;
  shownAt?: number;
}

export function useRecordingProtection(): RecordingProtection {
  const [isActive, setIsActive] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [hiddenDurations, setHiddenDurations] = useState<number[]>([]);

  const wakeLockRef = useRef<any>(null);
  const visibilityWindowsRef = useRef<VisibilityWindow[]>([]);
  const wakeLockSupported = typeof navigator !== "undefined" && "wakeLock" in navigator;

  // Visibility change listener — aktivní jen když isActive
  useEffect(() => {
    if (!isActive) return;

    function onVisibilityChange() {
      if (document.hidden) {
        // Přepnuto do background — zaznamenat
        visibilityWindowsRef.current.push({ hiddenAt: Date.now() });
        // Nemůžeme zachránit Wake Lock — iOS ho zruší automaticky
      } else {
        // Návrat do foreground
        const last = visibilityWindowsRef.current[visibilityWindowsRef.current.length - 1];
        if (last && !last.shownAt) {
          last.shownAt = Date.now();
          const dur = last.shownAt - last.hiddenAt;
          setHiddenDurations((prev) => [...prev, dur]);
        }
        // Pokus o re-acquire Wake Lock (po návratu z background ho iOS uvolnil)
        void requestWakeLockInternal();
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [isActive]);

  // Cleanup při unmount
  useEffect(() => {
    return () => {
      void releaseWakeLockInternal();
    };
  }, []);

  async function requestWakeLockInternal() {
    if (!wakeLockSupported) return;
    try {
      const lock = await (navigator as any).wakeLock.request("screen");
      wakeLockRef.current = lock;
      setWakeLockActive(true);
      lock.addEventListener("release", () => {
        wakeLockRef.current = null;
        setWakeLockActive(false);
      });
    } catch {
      // Některé browsery odmítnou Wake Lock pokud uživatel nedává explicit gesture
      setWakeLockActive(false);
    }
  }

  async function releaseWakeLockInternal() {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
      } catch {
        // ignore
      }
      wakeLockRef.current = null;
      setWakeLockActive(false);
    }
  }

  const start = useCallback(async () => {
    visibilityWindowsRef.current = [];
    setHiddenDurations([]);
    setIsActive(true);
    await requestWakeLockInternal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wakeLockSupported]);

  const stop = useCallback((audioBlob: Blob | null, elapsedMs: number): string | null => {
    setIsActive(false);
    void releaseWakeLockInternal();

    // Spočítej celkový čas v background
    const totalHiddenMs = hiddenDurations.reduce((s, d) => s + d, 0);

    // Sanity check: kolik audio reálně máme vs. kolik mělo být?
    // Audio blob velikost ~ délka × bitrate. Pro typické MediaRecorder
    // (Opus ~32-64 kbps) máme cca 4-8 KB/s. Hrubý odhad:
    //   audioMs ≈ (blob.size / 5500) × 1000  (5.5 KB/s = 44 kbps střední)
    let audioMsEstimate = 0;
    if (audioBlob && audioBlob.size > 0) {
      audioMsEstimate = (audioBlob.size / 5500) * 1000;
    }

    const warnings: string[] = [];

    if (totalHiddenMs > 5000) {
      // Tab byl >5s v background → na iOS Safari to znamená přerušení
      const sec = Math.round(totalHiddenMs / 1000);
      warnings.push(`Byl jsi mimo Ozvěnu ${sec} s — na iOS to typicky přeruší nahrávání.`);
    }

    if (audioBlob && audioMsEstimate > 0) {
      const ratio = audioMsEstimate / elapsedMs;
      if (ratio < 0.6 && elapsedMs > 10_000) {
        // Audio je výrazně kratší než uplynulý čas — nahrávání se zaseklo
        const audioSec = Math.round(audioMsEstimate / 1000);
        const elapsedSec = Math.round(elapsedMs / 1000);
        warnings.push(
          `Audio (~${audioSec} s) je kratší než uplynulý čas (${elapsedSec} s). Část záznamu chybí.`,
        );
      }
    }

    if (audioBlob && audioBlob.size === 0) {
      warnings.push("Audio je prázdné — nahrávání se nezdařilo.");
    }

    if (warnings.length === 0) return null;

    return [
      "⚠ Záznam má potenciální problém:",
      ...warnings.map((w) => `• ${w}`),
      "",
      "Doporučení pro dlouhé záznamy: použij iOS Hlasové poznámky / Voice Memos a pak audio nahraj přes „Nahrát soubor“ v Ozvěně.",
    ].join("\n");
  }, [hiddenDurations]);

  const cancel = useCallback(() => {
    setIsActive(false);
    void releaseWakeLockInternal();
    visibilityWindowsRef.current = [];
    setHiddenDurations([]);
  }, []);

  return {
    isActive,
    wakeLockSupported,
    wakeLockActive,
    hiddenDurations,
    start,
    stop,
    cancel,
  };
}

/**
 * UI helper komponent: banner s tipy před začátkem nahrávání.
 * Použij v recorderu nad Start tlačítkem.
 */
export function recordingProtectionTip(wakeLockSupported: boolean): string {
  if (!wakeLockSupported) {
    return "Tip: drž telefon odemčený a neopouštěj appku — pro dlouhé záznamy (>5 min) doporučujeme nahrát v iOS Hlasové poznámky a pak upload.";
  }
  return "Drž telefon odemčený, neopouštěj appku. Telefon se automaticky neuzamkne. Pro záznamy >10 min doporučujeme Voice Memos → upload.";
}
