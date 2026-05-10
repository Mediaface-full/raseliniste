import { useEffect, useState } from "react";
import { Send, Loader2, RefreshCw, Pin, Check, Clock, TriangleAlert } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface Reply {
  id: string;
  fromNumber: string;
  body: string;
  receivedAt: string;
}

interface SmsRow {
  id: string;
  gosmsMessageId: string | null;
  recipients: string[];
  invalidRecipients: string[];
  body: string;
  channelId: number;
  status: "pending" | "sent" | "delivered" | "undelivered" | "failed" | "cancelled";
  scheduledFor: string | null;
  linkedEntity: { type: string; id?: string; label?: string } | null;
  cost: number | null;
  currency: string | null;
  isPinned: boolean;
  sentAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  replies: Reply[];
}

export default function SmsLog({ enabled }: { enabled: boolean }) {
  const [messages, setMessages] = useState<SmsRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSend, setShowSend] = useState(false);
  const [to, setTo] = useState("");
  const [body, setBody] = useState("");

  async function load() {
    if (!enabled) return;
    setLoading(true);
    try {
      const res = await fetch("/api/sms/log?limit=50");
      const data = await res.json();
      if (res.ok) setMessages(data.messages ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(); /* eslint-disable-next-line */
  }, [enabled]);

  async function send() {
    if (!to.trim() || !body.trim()) return;
    setError(null);
    setSending(true);
    try {
      const res = await fetch("/api/sms/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          to: to.trim(),
          message: body.trim(),
          linkedEntity: { type: "ad-hoc", label: "ručně z nastavení" },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Odeslání selhalo.");
        return;
      }
      setTo("");
      setBody("");
      setShowSend(false);
      load();
    } catch {
      setError("Síťová chyba.");
    } finally {
      setSending(false);
    }
  }

  if (!enabled) {
    return (
      <div className="glass rounded-2xl p-6">
        <p className="text-sm text-muted-foreground">
          Po nakonfigurování GoSMS výše se zde zobrazí historie odeslaných SMS.
        </p>
      </div>
    );
  }

  const charsLeft = 160 - body.length;
  const partsCount = body.length === 0 ? 1 : Math.ceil(body.length / 160);

  return (
    <div className="glass rounded-2xl p-6 space-y-4">
      <header className="flex items-center justify-between">
        <h2 className="font-serif text-xl">Historie SMS</h2>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={load} disabled={loading} aria-label="Obnovit">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
          <Button onClick={() => setShowSend((s) => !s)}>
            <Send className="w-4 h-4" /> Poslat SMS
          </Button>
        </div>
      </header>

      {error && (
        <div className="flex items-start gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
          <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {showSend && (
        <div className="space-y-2 border border-border rounded-lg p-3 bg-background/30">
          <div className="text-xs text-muted-foreground">Ad-hoc SMS — pošle se přes výchozí kanál.</div>
          <Input
            placeholder="+420 777 123 456"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <textarea
            placeholder="Text zprávy"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-sm resize-y"
          />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {body.length} znaků · {partsCount} {partsCount === 1 ? "část" : "části"}
              {charsLeft >= 0 ? ` (do limitu zbývá ${charsLeft})` : ""}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setShowSend(false)}>Zrušit</Button>
              <Button onClick={send} disabled={sending || !to.trim() || !body.trim()}>
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Odeslat
              </Button>
            </div>
          </div>
        </div>
      )}

      {messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">Zatím žádné SMS.</p>
      ) : (
        <ul className="space-y-2">
          {messages.map((m) => (
            <li
              key={m.id}
              className="border border-border rounded-lg p-3 bg-background/30 space-y-1"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <StatusBadge status={m.status} />
                    {m.isPinned && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-300">
                        <Pin className="w-3 h-3" /> pinned
                      </span>
                    )}
                    {m.linkedEntity && (
                      <span className="px-2 py-0.5 rounded-full bg-muted/30 text-muted-foreground">
                        {m.linkedEntity.type}
                        {m.linkedEntity.label ? ` · ${m.linkedEntity.label}` : ""}
                      </span>
                    )}
                    <span className="text-muted-foreground">
                      → {m.recipients.join(", ")}
                    </span>
                  </div>
                  <p className="text-sm mt-1 break-words">{m.body}</p>
                  {m.errorMessage && (
                    <p className="text-xs text-red-400 mt-1">{m.errorMessage}</p>
                  )}
                  {m.invalidRecipients.length > 0 && (
                    <p className="text-xs text-amber-400 mt-1">
                      Neplatní příjemci: {m.invalidRecipients.join(", ")}
                    </p>
                  )}
                  {m.replies.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
                      {m.replies.map((r) => (
                        <div key={r.id} className="text-xs">
                          <span className="text-muted-foreground">{r.fromNumber} →</span>{" "}
                          <span>{r.body}</span>
                          <span className="text-muted-foreground ml-2">
                            {new Date(r.receivedAt).toLocaleString("cs-CZ")}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="text-right text-xs text-muted-foreground shrink-0">
                  <div>{new Date(m.createdAt).toLocaleString("cs-CZ")}</div>
                  {m.cost !== null && (
                    <div className="font-mono">
                      {m.cost.toFixed(2)} {m.currency ?? ""}
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: SmsRow["status"] }) {
  const map: Record<SmsRow["status"], { label: string; className: string; icon: React.ReactNode }> = {
    pending: { label: "čeká", className: "bg-sky-400/15 text-sky-300", icon: <Clock className="w-3 h-3" /> },
    sent: { label: "odesláno", className: "bg-blue-400/15 text-blue-300", icon: <Send className="w-3 h-3" /> },
    delivered: { label: "doručeno", className: "bg-emerald-400/15 text-emerald-300", icon: <Check className="w-3 h-3" /> },
    undelivered: { label: "nedoručeno", className: "bg-amber-400/15 text-amber-300", icon: <TriangleAlert className="w-3 h-3" /> },
    failed: { label: "chyba", className: "bg-red-400/15 text-red-300", icon: <TriangleAlert className="w-3 h-3" /> },
    cancelled: { label: "zrušeno", className: "bg-muted/30 text-muted-foreground", icon: null },
  };
  const m = map[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${m.className}`}>
      {m.icon}
      {m.label}
    </span>
  );
}
