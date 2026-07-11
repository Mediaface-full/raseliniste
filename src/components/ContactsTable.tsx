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
import { createPortal } from "react-dom";
import { ContactEditor } from "./ContactEditor";
import {
  Search, Save, RefreshCw, Loader2, AlertTriangle, Check, Cloud, CloudUpload,
  Users, Phone, Mail, Filter, X, ChevronLeft, ChevronRight, Trash2,
  Wrench, Plus, UserPlus, FolderPlus, Edit3,
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

interface GoogleStatus {
  connected: boolean;
  hasContactsScope: boolean;
  username: string | null;
}

interface Props {
  initialTotal: number;
  icloudStatus: IcloudStatus;
  googleStatus: GoogleStatus;
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

export default function ContactsTable({ initialTotal, icloudStatus, googleStatus }: Props) {
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
  const [dirty, setDirty] = useState<Map<string, { id: string; field: string; value: string | number | boolean | null | string[] }>>(new Map());
  const [saving, setSaving] = useState(false);
  // Petr 2026-05-15: rozdělené stavy per provider — sdílený `syncing` rozsvěcoval
  // spinnery u OBOU tlačítek najednou, i když uživatel klikl jen jedno.
  const [syncingIcloud, setSyncingIcloud] = useState(false);
  const [syncingGoogle, setSyncingGoogle] = useState(false);
  const syncing = syncingIcloud || syncingGoogle; // jen pro celkovou pojistku (např. disable Save tlačítka)
  const [pushingId, setPushingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Petr 2026-06-10: „+ Nový kontakt" otevírá ContactEditor modal
  // (z ContactsManager.tsx). Předchozí UX vytvořilo placeholder řádek
  // v tabulce — Petr ho hledal a frustroval se.
  const [newContactModalOpen, setNewContactModalOpen] = useState(false);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Real-time sync progress (Petr 2026-05-16) — polluje à 2s pokud syncing
  const [syncProgress, setSyncProgress] = useState<{
    provider: string;
    stage: string;
    current: number;
    total: number;
    mergedClusters: number;
    message?: string;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (!syncingIcloud && !syncingGoogle) {
      // Po dokončení sync (state false) ještě 5s držet progress aby Petr viděl
      // final "Hotovo" hlášku
      const t = setTimeout(() => setSyncProgress(null), 5000);
      return () => clearTimeout(t);
    }
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/contacts/sync-progress");
        const data = await res.json();
        if (active && data.ok && data.progress) {
          setSyncProgress(data.progress);
        }
      } catch { /* ignore */ }
    };
    void poll();
    const id = setInterval(poll, 2000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [syncingIcloud, syncingGoogle]);

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
  function editCell(contactId: string, field: string, value: string | number | boolean | null | string[]) {
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
        setMessage(`Uloženo ${changes.length} změn.`);
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
    setSyncingIcloud(true);
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
      const am = s.autoMerge;
      const fc = s.finalContactCount;
      const parts = [
        `iCloud sync OK`,
        `staženo ${s.pulled}`,
        s.created > 0 ? `vytvořeno ${s.created}` : null,
        s.matched > 0 ? `spárováno ${s.matched}` : null,
        s.updated > 0 ? `update ${s.updated}` : null,
        s.errors > 0 ? `chyby ${s.errors}` : null,
        am && am.merged > 0 ? `auto-sloučeno ${am.merged} dup` : null,
        fc ? `→ celkem ${fc} kontaktů` : null,
      ].filter(Boolean).join(" · ");
      setMessage(parts);
      setTimeout(() => setMessage(null), 12000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncingIcloud(false);
    }
  }

  /** Obousměrný sync s Google Workspace (Petr 2026-05-15 — vedle iCloud sync). */
  async function runGoogleSync() {
    if (!confirm("Obousměrný sync s Google Workspace (last-write-wins). Overlay pole (VIP/aliasy/klient slug) se nepřepisují. Pokud chybí Google scope `contacts`, proběhne reauth v /settings/integrations/google.")) return;
    setSyncingGoogle(true);
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
      setMessage(`Google sync hotový. Z Google: vytvořeno ${data.pulledCreated}, update ${data.pulledUpdated}. Do Google: vytvořeno ${data.created}, update ${data.updated}. Chyb ${data.errors}.`);
      setTimeout(() => setMessage(null), 8000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncingGoogle(false);
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
      setMessage("Posláno do iCloudu.");
      setTimeout(() => setMessage(null), 2000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPushingId(null);
    }
  }

  /**
   * Smazat kontakt — z DB + best-effort taky z iCloud (pokud má icloudHref) +
   * Google (pokud má googleResourceName). Petr 2026-05-16: chce smazat z všeho.
   */
  async function deleteContact(contactId: string, displayName: string) {
    if (!confirm(`Smazat kontakt "${displayName}" z Rašeliniště, iCloudu i Google?\n\nAuto-záloha proběhne před smazáním (Obnova ze zálohy v Nástrojích).`)) return;
    setDeletingId(contactId);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/contacts/${contactId}/delete-everywhere`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Smazání selhalo.");
        return;
      }
      const parts = [
        "Smazáno",
        data.deletedFromIcloud ? "iCloud " : data.icloudError ? `iCloud (${data.icloudError})` : null,
        data.deletedFromGoogle ? "Google " : data.googleError ? `Google (${data.googleError})` : null,
        "z DB ",
      ].filter(Boolean).join(" · ");
      setMessage(parts);
      setTimeout(() => setMessage(null), 6000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingId(null);
    }
  }

  /**
   * Discard — zahodit lokální dirty edits, znovu z DB.
   */
  function discardAll() {
    if (dirty.size === 0) return;
    if (!confirm(`Zahodit ${dirty.size} neuložených změn?`)) return;
    setLocalEdits(new Map());
    setDirty(new Map());
    setMessage("Změny zahozeny.");
    setTimeout(() => setMessage(null), 2000);
  }

  /**
   * Save dirty + push do iCloudu per-row (Uložit + Google volá zvlášť Google).
   * Po save automaticky push do iCloudu všech dirty rows.
   */
  async function saveAllAndPushIcloud() {
    if (dirtyCount === 0) {
      setMessage("Nic neuloženo — žádné změny.");
      setTimeout(() => setMessage(null), 2000);
      return;
    }
    const dirtyIds = Array.from(dirty.values()).map((d) => d.id);
    await saveAll();
    // Po save push každý dirty kontakt do iCloudu
    let pushed = 0;
    let pushFailed = 0;
    for (const id of dirtyIds) {
      try {
        const res = await fetch("/api/contacts/icloud/push", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ contactId: id }),
        });
        if (res.ok) pushed++; else pushFailed++;
      } catch { pushFailed++; }
    }
    setMessage(`Uloženo do DB a iCloudu (${pushed} push, ${pushFailed} selhalo).`);
    setTimeout(() => setMessage(null), 5000);
    await load();
  }

  /** Save + push do iCloud + obousměrný sync s Google */
  async function saveAllAndSyncGoogle() {
    await saveAllAndPushIcloud();
    await runGoogleSync();
  }

  /**
   * Vytvoří nový prázdný kontakt — POST /api/contacts, pak refresh.
   */
  /**
   * Petr 2026-05-18: žádný prompt dialog — rovnou založ prázdný kontakt
   * s placeholder názvem, scrollni na něj a označ jako dirty. Petr ho
   * přejmenuje inline v tabulce a klikne Uložit.
   */
  async function createNewContact() {
    try {
      const placeholderName = "(nový kontakt)";
      const res = await fetch("/api/contacts", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: placeholderName, syncSource: "manual", importedFrom: "manual" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Vytvoření selhalo.");
        return;
      }
      setMessage(`Prázdný kontakt přidán. Přepiš jméno v prvním sloupci a klikni Uložit.`);
      setTimeout(() => setMessage(null), 5000);
      await load();
      // Scroll + focus na nový řádek (pokud máme ID v response)
      const newId: string | undefined = data?.id;
      if (newId && typeof window !== "undefined") {
        requestAnimationFrame(() => {
          const row = document.querySelector<HTMLElement>(`[data-row-id="${newId}"]`);
          if (row) {
            row.scrollIntoView({ behavior: "smooth", block: "center" });
            const firstInput = row.querySelector<HTMLInputElement>("input[type='text'], input:not([type])");
            if (firstInput) {
              firstInput.focus();
              firstInput.select();
            }
          }
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Nová skupina — POST /api/contacts/groups.
   */
  async function createNewGroup() {
    const name = prompt("Název nové skupiny:")?.trim();
    if (!name) return;
    try {
      const res = await fetch("/api/contacts/groups", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Vytvoření skupiny selhalo.");
        return;
      }
      setMessage(data.existed ? `Skupina "${name}" už existuje.` : `Skupina "${name}" vytvořena.`);
      setTimeout(() => setMessage(null), 3000);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const dirtyCount = dirty.size;
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsBtnRef = useRef<HTMLButtonElement>(null);
  const [toolsPos, setToolsPos] = useState<{ top: number; right: number } | null>(null);

  function openTools() {
    const rect = toolsBtnRef.current?.getBoundingClientRect();
    if (rect) {
      setToolsPos({
        top: rect.bottom + 6,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    }
    setToolsOpen(true);
  }

  function runTool(action: () => void) {
    setToolsOpen(false);
    action();
  }

  return (
    <div className="space-y-4">
      {/* Hero — title + status pily + Sync + Nástroje dropdown */}
      <div className="glass rounded-2xl p-3 flex flex-wrap items-center gap-2">
        <Users className="size-4 text-muted-foreground" />
        <h1 className="text-lg font-bold tracking-[-0.02em]">Kontakty</h1>
        <span className="text-xs font-mono text-muted-foreground">
          {total.toLocaleString("cs-CZ")} kontaktů
          {dirtyCount > 0 && <span className="text-[color:var(--c-signal)]"> · {dirtyCount} neuložených</span>}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {icloudStatus.connected ? (
            <span className="text-xs px-2 py-0.5 rounded-full border border-border bg-secondary/40 text-foreground font-mono">iCloud {icloudStatus.username}</span>
          ) : (
            <a href="/settings/integrations/icloud" className="text-xs px-2 py-0.5 rounded-full border border-destructive/40 bg-destructive/10 text-destructive font-mono hover:underline">iCloud nepřipojen</a>
          )}
          {googleStatus.connected && googleStatus.hasContactsScope ? (
            <span className="text-xs px-2 py-0.5 rounded-full border border-border bg-secondary/40 text-foreground font-mono">Google {googleStatus.username ?? ""}</span>
          ) : googleStatus.connected ? (
            <a href="/settings/integrations/google" className="text-xs px-2 py-0.5 rounded-full border border-[color:var(--c-signal)]/40 bg-[color:var(--c-signal)]/10 text-[color:var(--c-signal)] font-mono hover:underline">Google reauth</a>
          ) : (
            <a href="/settings/integrations/google" className="text-xs px-2 py-0.5 rounded-full border border-destructive/40 bg-destructive/10 text-destructive font-mono hover:underline">Google nepřipojen</a>
          )}
          <button
            onClick={runIcloudSync}
            disabled={syncingIcloud || syncingGoogle || !icloudStatus.connected}
            title="Stáhnout kontakty z iCloudu + auto-merge duplicit"
            className="px-2.5 py-1 rounded-md border border-border bg-secondary/40 text-foreground text-xs font-medium flex items-center gap-1 disabled:opacity-40 hover:bg-accent"
          >
            {syncingIcloud ? <Loader2 className="size-3 animate-spin" /> : <Cloud className="size-3" />}
            Sync iCloud
          </button>
          <button
            onClick={runGoogleSync}
            disabled={syncingIcloud || syncingGoogle}
            title="Obousměrný sync s Google Workspace"
            className="px-2.5 py-1 rounded-md border border-border bg-secondary/40 text-foreground text-xs font-medium flex items-center gap-1 disabled:opacity-40 hover:bg-accent"
          >
            {syncingGoogle ? <Loader2 className="size-3 animate-spin" /> : <Cloud className="size-3" />}
            Sync Google
          </button>
          <button
            ref={toolsBtnRef}
            onClick={openTools}
            title="Akce — uložit, obnovit, přidat kontakt/skupinu, zahodit"
            className="px-2.5 py-1 rounded-md border border-foreground/30 bg-foreground text-background text-xs font-medium flex items-center gap-1 hover:opacity-90"
          >
            <Wrench className="size-3" />
            Nástroje
            {dirtyCount > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-[color:var(--c-signal)] text-white text-[10px] font-mono">{dirtyCount}</span>
            )}
          </button>
        </div>
      </div>

      {/* Filter bar — jen Search (zvýrazněný) + Page size + Validace */}
      <div className="rounded-xl p-3 border border-border bg-card flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => { setSearchInput(e.target.value); setPage(1); }}
            placeholder="jméno, e-mail, telefon, firma…"
            className="w-full pl-10 pr-3 py-2.5 rounded-md border-2 border-border bg-background text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:border-foreground/60 focus:ring-2 focus:ring-foreground/10 transition"
          />
        </div>
        <select
          value={pageSize}
          onChange={(e) => { setPageSize(parseInt(e.target.value, 10)); setPage(1); }}
          className="px-3 py-2.5 rounded-md border border-border bg-background text-foreground text-sm font-mono"
          title="Velikost stránky"
        >
          {[10, 25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <select
          value={validation}
          onChange={(e) => { setValidation(e.target.value as ValidationFilter); setPage(1); }}
          className="px-3 py-2.5 rounded-md border border-border bg-background text-foreground text-sm"
          title="Validační filtr"
        >
          {Object.entries(VALIDATION_LABELS).map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
      </div>

      {/* Nástroje dropdown — Portal pattern kvůli backdrop-filter glass parents. */}
      {toolsOpen && toolsPos && typeof document !== "undefined" && createPortal(
        <>
          <div className="fixed inset-0 z-[100]" onClick={() => setToolsOpen(false)} />
          <div
            className="fixed z-[101] w-64 rounded-lg border border-border bg-popover shadow-2xl p-1.5"
            style={{ top: toolsPos.top, right: toolsPos.right }}
          >
            <button
              onClick={() => runTool(createNewContact)}
              className="w-full px-3 py-2 rounded-md text-left text-sm flex items-center gap-2 hover:bg-accent"
            >
              <UserPlus className="size-4 text-[color:var(--c-signal)]" />
              <div className="flex-1">
                <div className="font-medium">Nový kontakt</div>
                <div className="text-[11px] text-muted-foreground">Prázdný řádek v tabulce</div>
              </div>
            </button>
            <button
              onClick={() => runTool(createNewGroup)}
              className="w-full px-3 py-2 rounded-md text-left text-sm flex items-center gap-2 hover:bg-accent"
            >
              <FolderPlus className="size-4 text-muted-foreground" />
              <div className="flex-1">
                <div className="font-medium">Nová skupina</div>
                <div className="text-[11px] text-muted-foreground">Klienti / Rodina / Tým…</div>
              </div>
            </button>

            <div className="h-px bg-border my-1.5" />

            <button
              onClick={() => runTool(saveAllAndPushIcloud)}
              disabled={dirtyCount === 0 || saving}
              className="w-full px-3 py-2 rounded-md text-left text-sm flex items-center gap-2 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4 text-muted-foreground" />}
              <div className="flex-1">
                <div className="font-medium">Uložit do iCloudu{dirtyCount > 0 && ` (${dirtyCount})`}</div>
                <div className="text-[11px] text-muted-foreground">DB + CardDAV push</div>
              </div>
            </button>
            <button
              onClick={() => runTool(saveAllAndSyncGoogle)}
              disabled={dirtyCount === 0 || saving || syncingGoogle}
              className="w-full px-3 py-2 rounded-md text-left text-sm flex items-center gap-2 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
            >
              {saving || syncingGoogle ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4 text-muted-foreground" />}
              <div className="flex-1">
                <div className="font-medium">Uložit + Google{dirtyCount > 0 && ` (${dirtyCount})`}</div>
                <div className="text-[11px] text-muted-foreground">DB + iCloud + Google sync</div>
              </div>
            </button>

            <div className="h-px bg-border my-1.5" />

            <button
              onClick={() => runTool(() => load())}
              disabled={loading}
              className="w-full px-3 py-2 rounded-md text-left text-sm flex items-center gap-2 hover:bg-accent disabled:opacity-40"
            >
              {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4 text-muted-foreground" />}
              <div className="flex-1">
                <div className="font-medium">Obnovit z DB</div>
                <div className="text-[11px] text-muted-foreground">Reload bez sync</div>
              </div>
            </button>
            <button
              onClick={() => runTool(discardAll)}
              disabled={dirtyCount === 0}
              className="w-full px-3 py-2 rounded-md text-left text-sm flex items-center gap-2 hover:bg-accent disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <X className="size-4 text-muted-foreground" />
              <div className="flex-1">
                <div className="font-medium">Zahodit změny{dirtyCount > 0 && ` (${dirtyCount})`}</div>
                <div className="text-[11px] text-muted-foreground">Bez uložení</div>
              </div>
            </button>
          </div>
        </>,
        document.body,
      )}

      {/* Sync progress banner — během sync + 5s po. Real-time čísla z DB
          (Petr 2026-05-16). Polling à 2s. */}
      {(syncingIcloud || syncingGoogle || syncProgress) && (
        <div className={`rounded-md border text-sm px-3 py-2 flex items-start gap-2 ${
          syncProgress?.stage === "error"
            ? "border-destructive/30 bg-destructive/10"
            : syncProgress?.stage === "done"
              ? "border-[var(--tint-sage)]/30 bg-[var(--tint-sage)]/10"
              : "border-[var(--tint-sky)]/30 bg-[var(--tint-sky)]/10"
        }`}>
          {syncProgress?.stage === "done" ? (
            <Check className="size-4 text-[var(--tint-sage)] shrink-0 mt-0.5" />
          ) : syncProgress?.stage === "error" ? (
            <AlertTriangle className="size-4 text-destructive shrink-0 mt-0.5" />
          ) : (
            <Loader2 className="size-4 animate-spin text-[var(--tint-sky)] shrink-0 mt-0.5" />
          )}
          <div className="flex-1 min-w-0">
            <div className="font-medium">
              {syncProgress?.provider === "google" ? "Google" : "iCloud"} sync
              {syncProgress?.stage === "done" ? " hotov" : syncProgress?.stage === "error" ? " selhal" : " běží"}
              {syncProgress && syncProgress.total > 0 && syncProgress.stage !== "done" && (
                <span className="ml-2 font-mono text-xs">
                  {syncProgress.current}/{syncProgress.total}
                  {syncProgress.mergedClusters > 0 && ` · sloučeno ${syncProgress.mergedClusters} clusterů`}
                </span>
              )}
            </div>
            {syncProgress?.message && (
              <div className="text-xs text-muted-foreground mt-0.5">{syncProgress.message}</div>
            )}
            {syncProgress?.error && (
              <div className="text-xs text-destructive mt-0.5">Chyba: {syncProgress.error}</div>
            )}
            {!syncProgress && (
              <div className="text-xs text-muted-foreground mt-0.5">
                Připravuji sync… (čísla se ukážou za chvíli)
              </div>
            )}
            {/* Progress bar */}
            {syncProgress && syncProgress.total > 0 && syncProgress.stage !== "done" && syncProgress.stage !== "error" && (
              <div className="mt-2 h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--tint-sky)] transition-all"
                  style={{ width: `${Math.min(100, (syncProgress.current / syncProgress.total) * 100)}%` }}
                />
              </div>
            )}
          </div>
        </div>
      )}

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
              className="text-xs font-mono px-2 py-1 rounded-full bg-secondary/40 text-foreground border border-border hover:bg-accent"
              title={`${g.count} členů — klik filtruje`}
            >
              {g.name} <span className="opacity-60">{g.count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Původní toolbar přesunut do hero výše (Petr 2026-05-16). */}

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
              <th className="px-2 py-2 text-left w-[200px]">Poznámka</th>
              <th className="px-2 py-2 text-center w-[60px]" title="VIP/Team flagy z Rašeliniště (overlay)">Flag</th>
              <th className="px-2 py-2 text-center w-[40px]" title="Push do iCloudu">⤴</th>
              <th className="px-2 py-2 text-center w-[40px]" title="Smazat kontakt (DB + iCloud + Google)"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={13} className="px-3 py-12 text-center text-sm text-muted-foreground">
                <Loader2 className="size-5 animate-spin mx-auto mb-2" /> Načítám…
              </td></tr>
            ) : contacts.length === 0 ? (
              <tr><td colSpan={13} className="px-3 py-12 text-center text-sm text-muted-foreground italic">
                Žádné kontakty v aktuálním filtru.
              </td></tr>
            ) : contacts.map((c) => {
              const eff = effective(c);
              const isDirty = Array.from(dirty.values()).some((d) => d.id === c.id);
              return (
                <tr key={c.id} data-row-id={c.id} className={`border-b border-white/5 hover:bg-white/[0.02] ${isDirty ? "bg-[var(--tint-rose)]/[0.06]" : ""}`}>
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
                  <EditableCell value={eff.note ?? ""} onSave={(v) => editCell(c.id, "note", v)} placeholder="—" />
                  <td className="px-2 py-2 text-center">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); editCell(c.id, "isVip", !eff.isVip); }}
                        title={eff.isVip ? "Klik = sundat VIP flag" : "Klik = označit jako VIP (po uložení dostanou odkaz na /call-log)"}
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded border transition ${
                          eff.isVip
                            ? "border-[color:var(--c-signal)]/60 bg-[color:var(--c-signal)]/15 text-[color:var(--c-signal)]"
                            : "border-border text-muted-foreground/40 hover:text-foreground hover:border-foreground/40"
                        }`}
                      >VIP</button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); editCell(c.id, "isTeam", !eff.isTeam); }}
                        title={eff.isTeam ? "Klik = sundat TÝM flag" : "Klik = označit jako člena týmu (Smart routing #3)"}
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded border transition ${
                          eff.isTeam
                            ? "border-foreground/60 bg-foreground/10 text-foreground"
                            : "border-border text-muted-foreground/40 hover:text-foreground hover:border-foreground/40"
                        }`}
                      >TÝM</button>
                      {eff.clientTag && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border bg-secondary/40 text-foreground" title={`Klient: ${eff.clientTag}`}>K</span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setEditingContactId(c.id); }}
                        title="Upravit kontakt (oslovení, aliasy, klient tag, todoist user, VIP odkaz na call-log)"
                        className="ml-0.5 p-1 rounded text-muted-foreground/50 hover:text-foreground hover:bg-accent transition"
                      >
                        <Edit3 className="size-3" />
                      </button>
                    </div>
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
                  <td className="px-2 py-2 text-center">
                    <button
                      onClick={() => deleteContact(c.id, eff.displayName)}
                      disabled={deletingId === c.id}
                      title="Smazat kontakt (DB + iCloud + Google)"
                      className="text-muted-foreground hover:text-[var(--tint-rose)] disabled:opacity-30"
                    >
                      {deletingId === c.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
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

      {/* Petr 2026-06-10: „+ Nový kontakt" modal s plným formulářem.
          ContactEditor je z ContactsManager.tsx (exportovaný). */}
      {newContactModalOpen && (
        <ContactEditor
          contact={null}
          onClose={(reload) => {
            setNewContactModalOpen(false);
            if (reload) {
              void load();
              setMessage("Kontakt přidán. Pokud chceš push do iCloudu/Google, klikni Uložit (iCloud) / Uložit + Google.");
              setTimeout(() => setMessage(null), 6000);
            }
          }}
        />
      )}

      {/* Petr 2026-06-19: edit existing contact = klik na ✎ ve sloupci Flag.
          Otevírá ContactEditor s plnými fields (oslovení / aliasy / clientTag
          / VIP odkaz na /call-log / todoist user). */}
      {editingContactId && (() => {
        const c = getContact(editingContactId);
        if (!c) return null;
        // Overlay pole přicházejí z /api/contacts/tabulka (GET vrací od
        // 2026-07-06 vocative/aliases/todoistUserId/defaultMeetLink/callLog*).
        const eff = effective(c) as Contact & {
          vocative?: string | null;
          greetingOverride?: string | null;
          aliases?: string[];
          clientTagAliases?: string[];
          todoistUserId?: string | null;
          defaultMeetLink?: string | null;
          callLogToken?: string | null;
          callLogTokenCreatedAt?: string | null;
        };
        return (
          <ContactEditor
            contact={{
              id: eff.id,
              displayName: eff.displayName,
              firstName: eff.firstName,
              lastName: eff.lastName,
              firstNameVocative: eff.vocative ?? null,
              greetingOverride: eff.greetingOverride ?? null,
              note: eff.note,
              isVip: eff.isVip,
              isTeam: eff.isTeam,
              clientTag: eff.clientTag,
              aliases: eff.aliases ?? [],
              clientTagAliases: eff.clientTagAliases ?? [],
              callLogToken: eff.callLogToken ?? null,
              callLogTokenCreatedAt: eff.callLogTokenCreatedAt ?? null,
              todoistUserId: eff.todoistUserId ?? null,
              defaultMeetLink: eff.defaultMeetLink ?? null,
              birthMonth: eff.birthMonth,
              birthDay: eff.birthDay,
              birthdayReminderDaysBefore: null,
              birthdayReminderChannels: [],
              importedFrom: null,
              phones: eff.phones,
              emails: eff.emails,
            }}
            onClose={(reload) => {
              setEditingContactId(null);
              if (reload) void load();
            }}
          />
        );
      })()}
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
