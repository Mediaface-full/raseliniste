import { useState, useEffect } from "react";
import { Loader2, AlertTriangle, RotateCw, Tag, Users, Calendar } from "lucide-react";
import { Button } from "./ui/Button";

interface Review {
  yearMonth: string;
  entryCount: number;
  reviewMarkdown: string;
  generatedAt: string;
  topTags: Array<{ tag: string; count: number }>;
  topPeople: Array<{ person: string; count: number }>;
  moodHistogram: Record<string, number>;
}

const MOOD_LABEL: Record<string, string> = {
  ELATED: "🌟 nadšený",
  CONTENT: "🙂 v pohodě",
  NEUTRAL: "😐 neutrální",
  TIRED: "😴 unavený",
  STRESSED: "😰 ve stresu",
  DOWN: "😔 smutný",
  ANGRY: "😠 naštvaný",
  MIXED: "🌗 smíšené",
};

export default function DenikMonthlyReview({ yearMonth }: { yearMonth: string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearMonth]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/denik/monthly/${yearMonth}`);
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Nepodařilo se vygenerovat review.");
        return;
      }
      const data = await res.json();
      setReview(data.review);
    } finally {
      setLoading(false);
    }
  }

  const [y, m] = yearMonth.split("-");
  const monthLabel = new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString("cs-CZ", { month: "long", year: "numeric" });

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <a href="/denik" className="text-xs font-mono text-muted-foreground hover:text-foreground">← Deník</a>
          <h1 className="font-serif text-2xl">Měsíční review · {monthLabel}</h1>
        </div>
        <div className="glass-strong rounded-xl p-8 text-center">
          <Loader2 className="size-12 animate-spin text-[var(--tint-butter)] mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Vertex Pro analyzuje hlavičky a poznámky editora…<br/>Trvá to typicky 30-90 s.</p>
        </div>
      </div>
    );
  }

  if (error || !review) {
    return (
      <div className="space-y-4">
        <a href="/denik" className="text-xs font-mono text-muted-foreground hover:text-foreground">← Deník</a>
        <div className="glass-strong rounded-xl p-6">
          <AlertTriangle className="size-8 text-destructive mb-2" />
          <h1 className="font-serif text-xl">Něco se nepodařilo</h1>
          <p className="text-sm text-destructive mt-1">{error}</p>
          <Button onClick={load} className="mt-4"><RotateCw /> Zkusit znovu</Button>
        </div>
      </div>
    );
  }

  const totalMood = Object.values(review.moodHistogram).reduce((s, c) => s + c, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <a href="/denik" className="text-xs font-mono text-muted-foreground hover:text-foreground">← Deník</a>
        <Calendar className="size-4 text-muted-foreground" />
        <h1 className="font-serif text-2xl">Měsíční review · {monthLabel}</h1>
        <Button variant="outline" size="sm" onClick={load} className="ml-auto">
          <RotateCw /> Regenerovat
        </Button>
      </div>

      {/* KPI shrnutí */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="glass rounded-xl p-4">
          <div className="text-xs uppercase tracking-widest font-mono text-muted-foreground">Zápisů</div>
          <div className="font-serif text-3xl mt-1">{review.entryCount}</div>
        </div>
        {Object.entries(review.moodHistogram).length > 0 && (
          <div className="glass rounded-xl p-4 col-span-2">
            <div className="text-xs uppercase tracking-widest font-mono text-muted-foreground mb-2">Náladový mix</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(review.moodHistogram)
                .sort((a, b) => b[1] - a[1])
                .map(([mood, count]) => (
                  <div key={mood} className="text-xs font-mono">
                    {MOOD_LABEL[mood] ?? mood} <span className="text-muted-foreground">{count}/{totalMood}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Top tagy a lidé */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="glass rounded-xl p-4">
          <div className="text-xs uppercase tracking-widest font-mono text-muted-foreground mb-2 flex items-center gap-1">
            <Tag className="size-3" /> Top témata
          </div>
          <div className="flex flex-wrap gap-1">
            {review.topTags.length === 0 ? (
              <span className="text-xs text-muted-foreground italic">žádná</span>
            ) : (
              review.topTags.slice(0, 12).map((t) => (
                <span key={t.tag} className="text-xs font-mono px-2 py-0.5 rounded bg-white/5">
                  #{t.tag} <span className="opacity-50">{t.count}</span>
                </span>
              ))
            )}
          </div>
        </div>
        <div className="glass rounded-xl p-4">
          <div className="text-xs uppercase tracking-widest font-mono text-muted-foreground mb-2 flex items-center gap-1">
            <Users className="size-3" /> Top lidé
          </div>
          <div className="flex flex-wrap gap-1">
            {review.topPeople.length === 0 ? (
              <span className="text-xs text-muted-foreground italic">žádní</span>
            ) : (
              review.topPeople.slice(0, 12).map((p) => (
                <span key={p.person} className="text-xs font-mono px-2 py-0.5 rounded bg-[var(--tint-lavender)]/10 text-[var(--tint-lavender)]">
                  {p.person} <span className="opacity-50">{p.count}</span>
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      {/* AI review */}
      <article className="glass rounded-xl p-5">
        <div className="text-xs uppercase tracking-widest font-mono text-muted-foreground mb-3">
          AI reflexe (Vertex Pro)
        </div>
        <div className="prose prose-invert max-w-none text-sm whitespace-pre-wrap leading-relaxed">
          {review.reviewMarkdown}
        </div>
        <div className="text-xs font-mono text-muted-foreground mt-4 pt-3 border-t border-white/5">
          Vygenerováno {new Date(review.generatedAt).toLocaleString("cs-CZ")} · pracuje jen s METADATA + POZNÁMKY EDITORA
        </div>
      </article>
    </div>
  );
}
