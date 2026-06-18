import { useEffect, useState } from "react";
import { Check, Loader2, Phone as PhoneIcon, Star, AlertTriangle, Mail, Inbox, ExternalLink } from "lucide-react";
import { Button } from "./ui/Button";

interface CallLogItem {
  id: string;
  phoneNumber: string;
  contactId: string | null;
  contact: { id: string; displayName: string; isVip: boolean } | null;
  message: string;
  isUrgent: boolean;
  wasVip: boolean;
  requestedDueAt: string | null;
  todoistTaskId: string | null;
  todoistError: string | null;
  mailSentAt: string | null;
  mailError: string | null;
  seenAt: string | null;
  createdAt: string;
}

export default function FirewallLog() {
  const [logs, setLogs] = useState<CallLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSeen, setShowSeen] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const url = showSeen ? "/api/call-log" : "/api/call-log?unseen=1";
      const res = await fetch(url);
      const data = await res.json();
      if (res.ok) setLogs(data.logs);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [showSeen]);

  async function markSeen(log: CallLogItem, seen: boolean) {
    await fetch(`/api/call-log/${log.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seen }),
    });
    load();
  }

  const unseen = logs.filter((l) => !l.seenAt);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="text-sm text-muted-foreground">
          {showSeen ? `${logs.length} záznamů` : `${unseen.length} nevyřízených`}
        </div>
        <div className="ml-auto flex gap-2">
          <Button
            variant={showSeen ? "outline" : "default"}
            onClick={() => setShowSeen(false)}
          >
            <Inbox /> Nevyřízené
          </Button>
          <Button
            variant={showSeen ? "default" : "outline"}
            onClick={() => setShowSeen(true)}
          >
            Všechny
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="glass rounded-xl p-6 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Načítám…
        </div>
      ) : logs.length === 0 ? (
        <div className="glass rounded-xl p-8 text-center text-muted-foreground">
          {showSeen ? "Zatím žádné vzkazy ve firewallu." : "Žádné nevyřízené vzkazy. "}
        </div>
      ) : (
        <div className="space-y-2">
          {logs.map((l) => {
            const created = new Date(l.createdAt);
            const tint = l.wasVip ? "rose" : l.isUrgent ? "butter" : "lavender";
            return (
              <div
                key={l.id}
                className="glass rounded-xl p-4"
                style={{
                  ["--c" as string]: `var(--tint-${tint})`,
                  opacity: l.seenAt ? 0.55 : 1,
                }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="size-10 rounded-md grid place-items-center shrink-0"
                    style={{
                      background: "color-mix(in oklch, var(--c) 18%, transparent)",
                      color: "var(--c)",
                    }}
                  >
                    {l.wasVip ? <Star className="size-4" fill="currentColor" /> : l.isUrgent ? <AlertTriangle className="size-4" /> : <PhoneIcon className="size-4" />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">
                        {l.contact?.displayName ?? "Neznámé číslo"}
                      </span>
                      {l.wasVip && (
                        <span className="text-[10px] uppercase font-mono tracking-wider px-1.5 py-0.5 rounded" style={{ background: "color-mix(in oklch, var(--c) 20%, transparent)", color: "var(--c)" }}>
                          VIP
                        </span>
                      )}
                      {l.isUrgent && (
                        <span className="text-[10px] uppercase font-mono tracking-wider px-1.5 py-0.5 rounded bg-[var(--tint-butter)]/20 text-[var(--tint-butter)]">
                          Urgent
                        </span>
                      )}
                      {l.requestedDueAt && (
                        <span className="text-[10px] uppercase font-mono tracking-wider px-1.5 py-0.5 rounded bg-[var(--tint-rose)]/20 text-[var(--tint-rose)]">
                          do {new Date(l.requestedDueAt).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric" })}
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-mono text-muted-foreground">
                      {l.phoneNumber} · {created.toLocaleString("cs-CZ", { timeZone: "Europe/Prague" })}
                    </div>
                    <div className="mt-2 text-sm whitespace-pre-wrap break-words">{l.message}</div>

                    <div className="mt-2 flex items-center gap-3 flex-wrap text-[11px] font-mono text-muted-foreground">
                      {l.todoistTaskId ? (
                        <span className="flex items-center gap-1 text-[var(--tint-sage)]">
                          <ExternalLink className="size-3" /> Todoist OK
                        </span>
                      ) : l.todoistError ? (
                        <span className="flex items-center gap-1 text-destructive" title={l.todoistError}>
                          <AlertTriangle className="size-3" /> Todoist chyba
                        </span>
                      ) : null}
                      {l.mailSentAt ? (
                        <span className="flex items-center gap-1 text-[var(--tint-sage)]">
                          <Mail className="size-3" /> Email odeslán
                        </span>
                      ) : l.mailError ? (
                        <span className="flex items-center gap-1 text-destructive" title={l.mailError}>
                          <Mail className="size-3" /> Email chyba
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    {l.seenAt ? (
                      <button
                        onClick={() => markSeen(l, false)}
                        className="text-[10px] font-mono text-muted-foreground hover:text-foreground px-2 py-1"
                      >
                        vrátit
                      </button>
                    ) : (
                      <Button size="sm" onClick={() => markSeen(l, true)}>
                        <Check /> Vyřízeno
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
