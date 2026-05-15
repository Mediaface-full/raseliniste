/**
 * Banner „Nově přidané z mobilu" (kontakty_brief.md 5.4).
 *
 * Detekuje kontakty s createdAt > baseline AND syncSource=icloud. Petr je
 * mohl přidat v terénu z iPhone Kontaktů a teď je vidí poprvé v Rašeliništi
 * po sync.
 */

import { useState, useEffect } from "react";
import { UserPlus, Eye, Check, X } from "lucide-react";

interface NewContact {
  id: string;
  displayName: string;
  createdAt: string;
}

export default function ContactsNewsBanner({ onFilterToNew }: { onFilterToNew?: (ids: string[]) => void }) {
  const [news, setNews] = useState<NewContact[] | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const res = await fetch("/api/contacts/news");
      const data = await res.json();
      if (res.ok && data.ok) {
        setNews(data.newContacts ?? []);
      }
    } catch { /* ignore */ }
  }

  async function markSeen() {
    setDismissed(true);
    try {
      await fetch("/api/contacts/news", { method: "POST" });
    } catch { /* ignore */ }
  }

  if (dismissed || !news || news.length === 0) return null;

  return (
    <div
      className="glass-strong rounded-xl p-4 flex flex-wrap items-center gap-3"
      style={{ borderLeft: "4px solid var(--tint-sage)", ["--c" as string]: "var(--tint-sage)" }}
    >
      <UserPlus className="size-5 shrink-0" style={{ color: "var(--c)" }} />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">
          🆕 {news.length} {news.length === 1 ? "nový kontakt" : news.length < 5 ? "nové kontakty" : "nových kontaktů"} od minulé prohlídky
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {news.slice(0, 5).map((n) => n.displayName).join(", ")}
          {news.length > 5 ? ` +${news.length - 5}` : ""}
        </div>
      </div>
      {onFilterToNew && (
        <button
          onClick={() => onFilterToNew(news.map((n) => n.id))}
          className="text-xs px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 flex items-center gap-1.5"
        >
          <Eye className="size-3.5" /> Zobrazit jen tyto
        </button>
      )}
      <button
        onClick={markSeen}
        className="text-xs px-3 py-1.5 rounded-md bg-[var(--tint-sage)]/15 hover:bg-[var(--tint-sage)]/25 text-[var(--tint-sage)] flex items-center gap-1.5"
      >
        <Check className="size-3.5" /> Označit jako prohlédnuté
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="text-muted-foreground hover:text-foreground p-1"
        aria-label="Zavřít"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
