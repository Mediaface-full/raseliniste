import { useState } from "react";
import { Loader2, Send, BookOpen, CheckSquare, Waves, AlertTriangle } from "lucide-react";

interface Citation {
  sourceType: "journal" | "task" | "studna";
  sourceId: string;
  chunkIdx: number;
  snippet: string;
  similarity: number;
}

interface RagAnswer {
  question: string;
  answer: string;
  citations: Citation[];
}

const SOURCE_META: Record<string, { label: string; icon: typeof BookOpen; tint: string; href: (id: string) => string }> = {
  journal: {
    label: "Deník",
    icon: BookOpen,
    tint: "butter",
    href: (id) => `/denik#entry-${id}`,
  },
  task: {
    label: "Úkol",
    icon: CheckSquare,
    tint: "peach",
    href: (id) => `/ukoly#task-${id}`,
  },
  studna: {
    label: "Studna",
    icon: Waves,
    tint: "mint",
    href: (id) => `/studna/aktivita#rec-${id}`,
  },
};

export default function AskWidget() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RagAnswer | null>(null);

  async function ask() {
    const q = question.trim();
    if (q.length < 2) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Něco se pokazilo.");
      } else {
        setResult(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void ask();
    }
  }

  // Render odpovědi s citacemi: nahradí [1], [2] klikatelnými superscripty
  function renderAnswer(answer: string, citations: Citation[]): JSX.Element[] {
    const parts: JSX.Element[] = [];
    const re = /\[(\d+)\]/g;
    let last = 0;
    let match: RegExpExecArray | null;
    let key = 0;
    while ((match = re.exec(answer)) !== null) {
      if (match.index > last) {
        parts.push(<span key={key++}>{answer.slice(last, match.index)}</span>);
      }
      const idx = parseInt(match[1], 10) - 1;
      const cit = citations[idx];
      if (cit) {
        const meta = SOURCE_META[cit.sourceType];
        parts.push(
          <a
            key={key++}
            href={meta.href(cit.sourceId)}
            className={`inline-flex items-center px-1 py-0.5 mx-0.5 rounded text-[10px] font-mono align-super`}
            style={{
              background: `color-mix(in oklch, var(--tint-${meta.tint}) 22%, transparent)`,
              color: `var(--tint-${meta.tint})`,
            }}
            title={cit.snippet}
          >
            [{idx + 1}]
          </a>,
        );
      } else {
        parts.push(<span key={key++}>{match[0]}</span>);
      }
      last = match.index + match[0].length;
    }
    if (last < answer.length) {
      parts.push(<span key={key++}>{answer.slice(last)}</span>);
    }
    return parts;
  }

  return (
    <div className="space-y-4">
      <div className="glass-strong rounded-xl p-4">
        <label className="block text-[10px] uppercase tracking-[0.18em] text-muted-foreground font-mono mb-1.5">
          Co chceš vědět?
        </label>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          placeholder='Např. „Co jsem psal o Karlovi v posledním měsíci?" nebo „Jaké úkoly mám otevřené k projektu Lipnice?"'
          className="w-full px-3 py-2.5 rounded-md bg-background/40 border border-border/60 focus:border-primary focus:outline-none text-base resize-none"
          disabled={loading}
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-[11px] font-mono text-muted-foreground/60">
            ⌘+Enter pro odeslání
          </span>
          <button
            onClick={ask}
            disabled={loading || question.trim().length < 2}
            className="px-4 py-2 rounded-md bg-[var(--tint-lavender)]/20 border border-[var(--tint-lavender)]/40 text-foreground font-medium text-sm flex items-center gap-2 hover:bg-[var(--tint-lavender)]/30 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {loading ? "Hledám…" : "Zeptat se"}
          </button>
        </div>
      </div>

      {error && (
        <div className="glass rounded-xl p-4 flex items-start gap-3 border border-destructive/30">
          <AlertTriangle className="size-5 text-destructive shrink-0 mt-0.5" />
          <div className="text-sm">{error}</div>
        </div>
      )}

      {result && (
        <div className="glass rounded-xl p-5 space-y-4">
          <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">
            Otázka
          </div>
          <div className="text-sm text-muted-foreground italic">„{result.question}"</div>

          <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground pt-2 border-t border-white/5">
            Odpověď
          </div>
          <div className="text-base leading-relaxed whitespace-pre-wrap">
            {renderAnswer(result.answer, result.citations)}
          </div>

          {result.citations.length > 0 && (
            <>
              <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground pt-2 border-t border-white/5">
                Odkazy ({result.citations.length})
              </div>
              <div className="space-y-2">
                {result.citations.map((c, i) => {
                  const meta = SOURCE_META[c.sourceType];
                  const Icon = meta.icon;
                  return (
                    <a
                      key={c.sourceId + "-" + c.chunkIdx}
                      href={meta.href(c.sourceId)}
                      className="block rounded-md p-3 hover:bg-white/5 transition border border-white/5"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Icon className="size-4" style={{ color: `var(--tint-${meta.tint})` }} />
                        <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                          [{i + 1}] {meta.label}
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground/60 ml-auto">
                          shoda {Math.round(c.similarity * 100)}%
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground/90 italic leading-relaxed line-clamp-3">
                        „{c.snippet}"
                      </div>
                    </a>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
