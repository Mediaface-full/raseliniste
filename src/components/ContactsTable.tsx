/**
 * ContactsTable — tabulková editace kontaktů s iCloud sync.
 *
 * Petr 2026-05-14/15 (kontakty_brief.md F1.5-F1.7):
 *   - Single-click edit buněk
 *   - Stránkování (10/25/50/100/200)
 *   - Fulltext search
 *   - Validační filtry (bez tel/email/skupiny/firma/...)
 *   - Chip seznam skupin
 *   - iCloud sync tlačítko + status
 *   - Bulk save dirty řádků
 *   - Per-row push do iCloudu
 *
 * Glass styling, Rašeliniště design tokeny, no fancy table libs.
 */

import { useState, useEffect, useMemo, useRef } from "react";
import {
  Search, Save, RefreshCw, Loader2, AlertTriangle, Check, Cloud, CloudUpload,
  Users, Phone, Mail, Filter, X, ChevronLeft, ChevronRight,
} from "lucide-react";

interface Contact {
  id: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  note: string | null;
  groups: string[];
  addressLines: string[];
  birthYear: number | null;
  birthMonth: number | null;
  birthDay: number | null;
  isVip: boolean;
  isTeam: boolean;
  clientTag: string | null;
  syncSource: string | null;
  icloudUid: string | null;
  lastIcloudSyncAt: string | null;
  phones: { id: string; number: string; label: string | null }[];
  emails: { id: string; email: string; label: string | null }[];
}

interface GroupChip {
  name: string;
  count: number;
}

interface IcloudStatus {
  connected: boolean;
  username: string | null;
  hasAddressbook: boolean;
  lastUsedAt: string | null;
  lastError: string | null;
}

interface Props {
  initialTotal: number;
  icloudStatus: IcloudStatus;
}

type ValidationFilter = "" | "no-phone" | "no-email" | "no-group" | "no-company" | "no-contact" | "incomplete-name";

const VALIDATION_LABELS: Record<ValidationFilter, string> = {
  "": "Vše",
  "no-phone": "Bez telefonu",
  "no-email": "Bez emailu",
  "no-group": "Bez skupiny",
  "no-company": "Bez firmy",
  "no-contact": "Bez telefonu i emailu",
  "incomplete-name": "Neúplné jméno",
};

// ============================================================================
// Component
// ============================================================================

export default function ContactsTable({ initialTotal, icloudStatus }: Props) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [groups, setGroups] = useState<GroupChip[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(initialTotal);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [validation, setValidation] = useState<ValidationFilter>("");
  const [validationCounts, setValidationCounts] = useState<Record<ValidationFilter, number>>({} as Record<ValidationFilter, number>);

  // Dirty tracking — pole změn neuložených na server. Klíč = contactId-field.
  const [dirty, setDirty] = useState<Map<string, { id: string; field: string; value: string | number | null | string[] }>>(new Map());
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pushingId, setPushingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Local edits — overlay nad fetched data, ať dirty se mění ihned v UI bez refetch
  const [localEdits, setLocalEdits] = useState<Map<string, Partial<Contact>>>(new Map());

  // Debounced search input
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Reload při změně page / search / validation
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, search, validation]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        ...(search ? { q: search } : {}),
        ...(validation ? { validation } : {}),
      });
      const res = await fetch(`/api/contacts/tabulka?${params}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Načtení selhalo.");
        return;
      }
      setContacts(data.contacts);
      setGroups(data.groups);
      setPages(data.pages);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  // Cell edit handler — uloží do dirty mapy + local edit
  function editCell(contactId: string, field: string, value: string | number | null | string[]) {
    const key = `${contactId}-${field}`;
    setDirty((m) => new Map(m).set(key, { id: contactId, field, value }));

    // Apply lokálně pro instant feedback
    setLocalEdits((m) => {
      const next = new Map(m);
      const existing = next.get(contactId) ?? {};
      // Map field → contact property
      if (field === "phone1" || field === "phone2" || field === "phone3") {
        const slot = parseInt(field.slice(5), 10) - 1;
        const phones = [...(existing.phones ?? getContact(contactId)?.phones ?? [])];
        if (typeof value === "string" && value.trim()) {
          if (phones[slot]) phones[slot] = { ...phones[slot], number: value };
          else phones[slot] = { id: `new-${slot}`, number: value, label: slot === 0 ? "mobile" : "work" };
        } else {
          phones.splice(slot, 1);
        }
        next.set(contactId, { ...existing, phones });
      } else if (field === "email1" || field === "email2") {
        const slot = parseInt(field.slice(5), 10) - 1;
        const emails = [...(existing.emails ?? getContact(contactId)?.emails ?? [])];
        if (typeof value === "string" && value.trim()) {
          if (emails[slot]) emails[slot] = { ...emails[slot], email: value };
          else emails[slot] = { id: `new-${slot}`, email: value, label: slot === 0 ? "work" : "home" };
        } else {
          emails.splice(slot, 1);
        }
        next.set(contactId, { ...existing, emails });
      } else if (field === "address") {
        next.set(contactId, { ...existing, addressLines: typeof value === "string" && value ? [value] : [] });
      } else if (field === "groups") {
        next.set(contactId, { ...existing, groups: Array.isArray(value) ? value : [] });
      } else {
        next.set(contactId, { ...existing, [field]: value });
      }
      return next;
    });
  }

  function getContact(id: string): Contact | undefined {
    return contacts.find((c) => c.id === id);
  }
  function effective(c: Contact): Contact {
    const overlay = localEdits.get(c.id);
    return overlay ? { ...c, ...overlay } as Contact : c;
  }

  async function saveAll() {
    if (dirty.size === 0) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const changes = Array.from(dirty.values());
      const res = await fetch("/api/contacts/tabulka", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ changes }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Uložení selhalo.");
        return;
      }
      const failed = (data.results as Array<{ ok: boolean; error?: string }>).filter((r) => !r.ok);
      if (failed.length > 0) {
        setError(`${failed.length} změn selhalo: ${failed.map((f) => f.error).join("; ")}`);
      } else {
        setMessage(`✓ Uloženo ${changes.length} změn.`);
        setTimeout(() => setMessage(null), 3000);
      }
      setDirty(new Map());
      setLocalEdits(new Map());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function runIcloudSync() {
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/contacts/icloud/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.stats?.error ?? data.error ?? "Sync selhal.");
        return;
      }
      const s = data.stats;
      setMessage(`✓ iCloud sync hotový. Staženo ${s.pulled}, vytvořeno ${s.created}, spárováno ${s.matched}, updatováno ${s.updated}, skupin ${s.groups}, chyb ${s.errors}.`);
      setTimeout(() => setMessage(null), 8000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  /** Obousměrný sync s Google Workspace (Petr 2026-05-15 — vedle iCloud sync). */
  async function runGoogleSync() {
    if (!confirm("Obousměrný sync s Google Workspace (last-write-wins). Overlay pole (VIP/aliasy/klient slug) se nepřepisují. Pokud chybí Google scope `contacts`, proběhne reauth v /settings/integrations/google.")) return;
    setSyncing(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/contacts/google/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "all", direction: "bidirectional" }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Google sync selhal. Pravděpodobně chybí Google scope `contacts` — reauth v /settings/integrations/google.");
        return;
      }
      setMessage(`✓ Google sync hotový. Z Google: vytvořeno ${data.pulledCreated}, update ${data.pulledUpdated}. Do Google: vytvořeno ${data.created}, update ${data.updated}. Chyb ${data.errors}.`);
      setTimeout(() => setMessage(null), 8000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  async function pushToIcloud(contactId: string) {
    setPushingId(contactId);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/contacts/icloud/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contactId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Push selhal.");
        return;
      }
      setMessage("✓ Posláno do iCloudu.");
      setTimeout(() => setMessage(null), 2000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPushingId(null);
    }
  }

  const dirtyCount = dirty.size;

  return (
    <div className="space-y-4">
      {/* Hero hlavička */}
      <div className="glass rounded-2xl p-4 flex flex-wrap items-center gap-3">
        <Users className="size-5 text-[var(--tint-lavender)]" />
        <h1 className="font-serif text-xl">Kontakty</h1>
        <span className="text-xs font-mono text-muted-foreground">
          {total.toLocaleString("cs-CZ")} kontaktů
          {dirtyCount > 0 && <span className="text-[var(--tint-rose)]"> · {dirtyCount} neuložených</span>}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {icloudStatus.connected ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--tint-sage)]/15 text-[var(--tint-sage)] font-mono">
              🟢 iCloud {icloudStatus.username}
            </span>
          ) : (
            <a
              href="/settings/integrations/icloud"
              className="text-xs px-2 py-0.5 rounded-full bg-[var(--tint-rose)]/15 text-[var(--tint-rose)] font-mono hover:underline"
            >
              ⚠ iCloud nepřipojen
            </a>
          )}
          <button
            onClick={runIcloudSync}
            disabled={syncing || !icloudStatus.connected}
            className="px-3 py-1.5 rounded-md bg-[var(--tint-sky)]/15 text-[var(--tint-sky)] border border-[var(--tint-sky)]/30 text-sm font-medium flex items-center gap-1.5 disabled:opacity-40"
          >
            {syncing ? <Loader2 className="size-3.5 animate-spin" /> : <Cloud className="size-3.5" />}
            Synchronizovat s iCloudem
          </button>
          <button
            onClick={runGoogleSync}
            disabled={syncing}
            className="px-3 py-1.5 rounded-md bg-[var(--tint-lavender)]/15 text-[var(--tint-lavender)] border border-[var(--tint-lavender)]/30 text-sm font-medium flex items-center gap-1.5 disabled:opacity-40"
            title="Obousměrný sync s Google Workspace (last-write-wins). Vyžaduje rozšířený OAuth scope contacts."
          >
            {syncing ? <Loader2 className="size-3.5 animate-spin" /> : <Cloud className="size-3.5" />}
            Synchronizovat s Google
          </button>
          <button
            onClick={saveAll}
            disabled={dirtyCount === 0 || saving}
            className="px-3 py-1.5 rounded-md bg-[var(--tint-sage)]/20 text-[var(--tint-sage)] border border-[var(--tint-sage)]/40 text-sm font-medium flex items-center gap-1.5 disabled:opacity-40"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Uložit ({dirtyCount})
          </button>
        </div>
      </div>

      {/* Status messages */}
      {message && (
        <div className="rounded-md border border-[var(--tint-sage)]/30 bg-[var(--tint-sage)]/10 text-sm px-3 py-2 flex items-center gap-2">
          <Check className="size-4 text-[var(--tint-sage)]" /> {message}
        </div>
      )}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {/* Skupiny chip — kontakty_brief.md 5.7 */}
      {groups.length > 0 && (
        <div className="glass rounded-xl p-3 flex flex-wrap items-center gap-2">
          <Users className="size-3.5 text-muted-foreground" />
          <span className="text-xs uppercase tracking-widest font-mono text-muted-foreground mr-2">Skupiny</span>
          {groups.map((g) => (
            <button
              key={g.name}
              onClick={() => setSearchInput(g.name)}
              className="text-xs font-mono px-2 py-1 rounded-full bg-[var(--tint-lavender)]/15 text-[var(--tint-lavender)] border border-[var(--tint-lavender)]/25 hover:bg-[var(--tint-lavender)]/25"
              title={`${g.count} členů — klik filtruje`}
            >
              {g.name} <span className="opacity-60">{g.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="glass rounded-xl p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => { setSearchInput(e.target.value); setPage(1); }}
            placeholder="Hledat (jméno, telefon, email, firma…)"
            className="w-full pl-8 pr-3 py-1.5 rounded-md bg-black/30 border border-white/10 text-sm"
          />
        </div>
        <select
          value={validation}
          onChange={(e) => { setValidation(e.target.value as ValidationFilter); setPage(1); }}
          className="px-2 py-1.5 rounded-md bg-black/30 border border-white/10 text-sm"
        >
          {Object.entries(VALIDATION_LABELS).map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
        <select
          value={pageSize}
          onChange={(e) => { setPageSize(parseInt(e.target.value, 10)); setPage(1); }}
          className="px-2 py-1.5 rounded-md bg-black/30 border border-white/10 text-sm font-mono"
        >
          {[10, 25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}/strana</option>)}
        </select>
      </div>

      {/* Tabulka */}
      <div className="glass rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground border-b border-white/10">
            <tr>
              <th className="px-2 py-2 text-left w-[150px]">Jméno</th>
              <th className="px-2 py-2 text-left w-[120px]">Příjmení</th>
              <th className="px-2 py-2 text-left w-[120px]">Firma</th>
              <th className="px-2 py-2 text-left w-[140px]">Telefon</th>
              <th className="px-2 py-2 text-left w-[120px]">Telefon 2</th>
              <th className="px-2 py-2 text-left w-[160px]">E-mail</th>
              <th className="px-2 py-2 text-left w-[180px]">Adresa</th>
              <th className="px-2 py-2 text-left w-[140px]">Skupiny</th>
              <th className="px-2 py-2 text-left w-[100px]">Narozeniny</th>
              <th className="px-2 py-2 text-center w-[60px]" title="VIP/Team flagy z Rašeliniště (overlay)">Flag</th>
              <th className="px-2 py-2 text-center w-[40px]" title="Push do iCloudu">⤴</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="px-3 py-12 text-center text-sm text-muted-foreground">
                <Loader2 className="size-5 animate-spin mx-auto mb-2" /> Načítám…
              </td></tr>
            ) : contacts.length === 0 ? (
              <tr><td colSpan={11} className="px-3 py-12 text-center text-sm text-muted-foreground italic">
                Žádné kontakty v aktuálním filtru.
              </td></tr>
            ) : contacts.map((c) => {
              const eff = effective(c);
              const isDirty = Array.from(dirty.values()).some((d) => d.id === c.id);
              return (
                <tr key={c.id} className={`border-b border-white/5 hover:bg-white/[0.02] ${isDirty ? "bg-[var(--tint-rose)]/[0.06]" : ""}`}>
                  <EditableCell value={eff.firstName ?? ""} onSave={(v) => editCell(c.id, "firstName", v)} />
                  <EditableCell value={eff.lastName ?? ""} onSave={(v) => editCell(c.id, "lastName", v)} />
                  <EditableCell value={eff.company ?? ""} onSave={(v) => editCell(c.id, "company", v)} />
                  <EditableCell
                    value={eff.phones[0]?.number ?? ""}
                    onSave={(v) => editCell(c.id, "phone1", v)}
                    icon={<Phone className="size-3 inline mr-1 opacity-40" />}
                  />
                  <EditableCell
                    value={eff.phones[1]?.number ?? ""}
                    onSave={(v) => editCell(c.id, "phone2", v)}
                  />
                  <EditableCell
                    value={eff.emails[0]?.email ?? ""}
                    onSave={(v) => editCell(c.id, "email1", v)}
                    icon={<Mail className="size-3 inline mr-1 opacity-40" />}
                  />
                  <EditableCell
                    value={eff.addressLines.join(" / ")}
                    onSave={(v) => editCell(c.id, "addressLines", v)}
                    placeholder="—"
                  />
                  <EditableCell
                    value={eff.groups.join(", ")}
                    onSave={(v) => editCell(c.id, "groups", v.split(",").map((s) => s.trim()).filter(Boolean))}
                    placeholder="—"
                  />
                  <BirthdayCell
                    year={eff.birthYear}
                    month={eff.birthMonth}
                    day={eff.birthDay}
                    onChange={(y, m, d) => {
                      editCell(c.id, "birthYear", y);
                      editCell(c.id, "birthMonth", m);
                      editCell(c.id, "birthDay", d);
                    }}
                  />
                  <td className="px-2 py-2 text-center">
                    {eff.isVip && <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-[var(--tint-rose)]/20 text-[var(--tint-rose)]">VIP</span>}
                    {eff.isTeam && <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-[var(--tint-sky)]/20 text-[var(--tint-sky)] ml-1">TÝM</span>}
                    {eff.clientTag && <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-[var(--tint-mint)]/20 text-[var(--tint-mint)] ml-1" title={eff.clientTag}>K</span>}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <button
                      onClick={() => pushToIcloud(c.id)}
                      disabled={pushingId === c.id || !icloudStatus.connected}
                      title="Poslat tento kontakt do iCloudu"
                      className="text-muted-foreground hover:text-[var(--tint-sky)] disabled:opacity-30"
                    >
                      {pushingId === c.id ? <Loader2 className="size-3.5 animate-spin" /> : <CloudUpload className="size-3.5" />}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Stránkování */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-2 py-1 rounded hover:bg-white/5 disabled:opacity-30"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="font-mono text-xs text-muted-foreground">
            {page} / {pages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            disabled={page === pages}
            className="px-2 py-1 rounded hover:bg-white/5 disabled:opacity-30"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// EditableCell — single-click edit
// ============================================================================

function EditableCell({
  value,
  onSave,
  icon,
  placeholder,
}: {
  value: string;
  onSave: (v: string) => void;
  icon?: React.ReactNode;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  useEffect(() => { setDraft(value); }, [value]);

  function commit() {
    if (draft !== value) onSave(draft);
    setEditing(false);
  }
  function cancel() {
    setDraft(value);
    setEditing(false);
  }

  if (editing) {
    return (
      <td className="px-2 py-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); (e.currentTarget.closest("tr")?.nextElementSibling?.querySelector("td:nth-child(" + (Array.from(e.currentTarget.closest("tr")!.children).indexOf(e.currentTarget.closest("td")!) + 1) + ")") as HTMLElement | null)?.click(); }
            if (e.key === "Escape") cancel();
          }}
          className="w-full px-1 py-0.5 rounded bg-black/40 border border-[var(--tint-sky)]/50 text-sm font-mono outline-none"
        />
      </td>
    );
  }

  return (
    <td className="px-2 py-2 cursor-pointer" onClick={() => setEditing(true)}>
      <span className="block truncate">
        {icon}
        {value || <span className="text-muted-foreground/50 italic">{placeholder ?? "—"}</span>}
      </span>
    </td>
  );
}

// ============================================================================
// BirthdayCell — date input (Y-M-D)
// ============================================================================

function BirthdayCell({
  year,
  month,
  day,
  onChange,
}: {
  year: number | null;
  month: number | null;
  day: number | null;
  onChange: (y: number | null, m: number | null, d: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const value = year && month && day
    ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : (month && day ? `??-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : "");

  function commit(v: string) {
    if (!v.trim()) {
      onChange(null, null, null);
    } else {
      // Akceptuje YYYY-MM-DD, D.M.YYYY, D/M
      const ymd = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (ymd) {
        onChange(parseInt(ymd[1]!, 10), parseInt(ymd[2]!, 10), parseInt(ymd[3]!, 10));
      } else {
        const dmy = v.match(/^(\d{1,2})[./](\d{1,2})[./]?(\d{4})?$/);
        if (dmy) {
          onChange(dmy[3] ? parseInt(dmy[3]!, 10) : null, parseInt(dmy[2]!, 10), parseInt(dmy[1]!, 10));
        }
      }
    }
    setEditing(false);
  }

  if (editing) {
    return (
      <td className="px-2 py-1">
        <input
          autoFocus
          defaultValue={value}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(e.currentTarget.value);
            if (e.key === "Escape") setEditing(false);
          }}
          placeholder="YYYY-MM-DD nebo D.M.YYYY"
          className="w-full px-1 py-0.5 rounded bg-black/40 border border-[var(--tint-sky)]/50 text-xs font-mono outline-none"
        />
      </td>
    );
  }

  return (
    <td className="px-2 py-2 cursor-pointer font-mono text-xs" onClick={() => setEditing(true)}>
      {value || <span className="text-muted-foreground/50 italic">—</span>}
    </td>
  );
}
