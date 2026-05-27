import { useEffect, useRef, useState } from "react";

/**
 * Petr 2026-05-25: in-place editovatelný název.
 *
 *   - Default: render <div> s textem.
 *   - Klik (myš/Enter/Space): switch na <input>, auto-focus + select all.
 *   - Blur nebo Enter: pokud value se změnila a není prázdná → onSave(trim).
 *   - Escape: zahodit, zpět na text bez uložení.
 *
 * Použito v UkolyList (TaskCard) a TaskAudioReview (ProposalRow), aby Petr
 * nemusel pro běžnou změnu názvu otevírat plný Edit panel.
 *
 * `done` flag jen vizuálně (přeškrtnutí, muted) — logika dokončení patří
 * volajícímu.
 */
export function InlineTitle({
  value,
  done = false,
  accent = "var(--tint-peach)",
  onSave,
  className = "",
}: {
  value: string;
  done?: boolean;
  /** Barva borderu při editaci. Default peach (úkoly), pro review proposal volat s peach taky. */
  accent?: string;
  onSave: (next: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  // Petr 2026-05-27: jen sync draft z value když NEEDITUJEME, jinak by
  // optimistic update / polling z parentu přepsal text co Petr právě píše.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onSave(trimmed);
    else setDraft(value);
  }

  if (!editing) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => setEditing(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditing(true);
          }
        }}
        className={`text-base font-medium leading-snug cursor-text rounded -mx-1 px-1 hover:bg-white/5 ${
          done ? "line-through text-muted-foreground" : "text-foreground"
        } ${className}`}
        title="Klikni pro úpravu"
      >
        {value}
      </div>
    );
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setDraft(value);
          setEditing(false);
        }
      }}
      style={{ borderColor: accent }}
      className={`w-full text-base font-medium leading-snug bg-black/40 border rounded -mx-1 px-1 py-0.5 text-foreground outline-none ${className}`}
    />
  );
}
