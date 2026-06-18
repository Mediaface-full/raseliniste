import { useEffect, useRef, useState } from "react";
import { Plus, Loader2, Save, Trash2, Upload, X, ImageIcon, PenTool, Wand2, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface Sender {
  id: string;
  name: string;
  legalName: string | null;
  ico: string | null;
  dic: string | null;
  addressLines: string[];
  email: string | null;
  phone: string | null;
  web: string | null;
  bankAccount: string | null;
  logoPath: string | null;
  signaturePath: string | null;
  redactPrompt: string;
  pdfTheme: string;
}

const DEFAULT_PROMPT =
  "Učeš text dopisu do formálního, zdvořilého a srozumitelného tónu. Zachovej oslovení i závěr napsané uživatelem. Neměň fakta. Vrať jen výsledný text bez vysvětlivek a bez markdown formátování.";

export default function LetterSendersManager({ firstRun = false }: { firstRun?: boolean }) {
  const [senders, setSenders] = useState<Sender[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(firstRun);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/letters/senders");
      const data = await res.json();
      if (res.ok) setSenders(data.senders);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function createSender(name: string) {
    const res = await fetch("/api/letters/senders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (res.ok) {
      setCreating(false);
      load();
      setExpandedId(data.sender.id);
    }
  }

  if (loading) {
    return (
      <div className="glass rounded-xl p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Načítám…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-serif text-xl">Odesílatelé dopisů</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Hlavičky pro různé role — osobní, firma, projekt. Každý odesílatel může mít své logo, sken
          podpisu a vlastní AI prompt pro „Učesat".
        </p>
      </div>

      {firstRun && senders.length === 0 && (
        <div
          className="glass rounded-xl p-4 text-sm"
          style={{ ["--c" as string]: "var(--tint-butter)" }}
        >
          <strong>Vytvoř prvního odesílatele</strong>, ať můžeš začít psát dopisy. Ten první je
          obvykle „osobní" — jméno, adresa bydliště, email.
        </div>
      )}

      {creating ? (
        <NewSenderForm onCancel={() => setCreating(false)} onCreate={createSender} />
      ) : (
        <Button onClick={() => setCreating(true)}>
          <Plus /> Přidat odesílatele
        </Button>
      )}

      <div className="space-y-3">
        {senders.map((s) => (
          <SenderCard
            key={s.id}
            sender={s}
            expanded={expandedId === s.id}
            onToggle={() => setExpandedId(expandedId === s.id ? null : s.id)}
            onChanged={load}
          />
        ))}
      </div>
    </div>
  );
}

function NewSenderForm({ onCancel, onCreate }: { onCancel: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="glass rounded-xl p-4 space-y-3" style={{ ["--c" as string]: "var(--tint-butter)" }}>
      <div className="text-sm font-medium">Nový odesílatel</div>
      <div>
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
          Pojmenování (jen pro tebe — např. „osobní", „ART76", „ABC s.r.o.")
        </label>
        <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      <div className="flex gap-2">
        <Button
          disabled={busy || !name.trim()}
          onClick={async () => {
            setBusy(true);
            await onCreate(name.trim());
            setBusy(false);
          }}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Plus />} Vytvořit
        </Button>
        <Button variant="ghost" onClick={onCancel}>Zrušit</Button>
      </div>
    </div>
  );
}

function SenderCard({
  sender,
  expanded,
  onToggle,
  onChanged,
}: {
  sender: Sender;
  expanded: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  return (
    <div className="glass rounded-xl overflow-hidden" style={{ ["--c" as string]: "var(--tint-butter)" }}>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left"
      >
        <div
          className="size-10 rounded-md grid place-items-center shrink-0 overflow-hidden"
          style={{ background: "color-mix(in oklch, var(--c) 18%, transparent)" }}
        >
          {sender.logoPath ? (
            <img src={`/api/uploads/${encodeURIComponent(sender.logoPath)}`} alt="" className="max-w-full max-h-full object-contain" />
          ) : (
            <ImageIcon className="size-5" style={{ color: "var(--c)" }} />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium">{sender.name}</div>
          <div className="text-xs text-muted-foreground">
            {sender.email || sender.legalName || sender.addressLines[0] || "bez detailů"}
          </div>
        </div>
        {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
      </button>

      {expanded && <SenderEditor sender={sender} onChanged={onChanged} />}
    </div>
  );
}

function SenderEditor({ sender, onChanged }: { sender: Sender; onChanged: () => void }) {
  const [name, setName] = useState(sender.name);
  const [legalName, setLegalName] = useState(sender.legalName ?? "");
  const [ico, setIco] = useState(sender.ico ?? "");
  const [dic, setDic] = useState(sender.dic ?? "");
  const [addr, setAddr] = useState(sender.addressLines.join("\n"));
  const [email, setEmail] = useState(sender.email ?? "");
  const [phone, setPhone] = useState(sender.phone ?? "");
  const [web, setWeb] = useState(sender.web ?? "");
  const [bank, setBank] = useState(sender.bankAccount ?? "");
  const [prompt, setPrompt] = useState(sender.redactPrompt);
  const [theme, setTheme] = useState<"classic" | "personal">(
    sender.pdfTheme === "personal" ? "personal" : "classic",
  );
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const sigRef = useRef<HTMLInputElement>(null);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/letters/senders/${sender.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          legalName: legalName.trim() || null,
          ico: ico.trim() || null,
          dic: dic.trim() || null,
          addressLines: addr.split("\n").map((l) => l.trim()).filter(Boolean),
          email: email.trim() || null,
          phone: phone.trim() || null,
          web: web.trim() || null,
          bankAccount: bank.trim() || null,
          redactPrompt: prompt,
          pdfTheme: theme,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Uložení selhalo.");
        return;
      }
      setSavedAt(Date.now());
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function uploadFile(kind: "logo" | "signature", file: File) {
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("file", file);
    const res = await fetch(`/api/letters/senders/${sender.id}/upload`, {
      method: "POST",
      body: fd,
    });
    if (res.ok) onChanged();
    else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Upload selhal.");
    }
  }

  async function removeFile(kind: "logo" | "signature") {
    if (!confirm(`Smazat ${kind === "logo" ? "logo" : "podpis"}?`)) return;
    const res = await fetch(`/api/letters/senders/${sender.id}/upload`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind }),
    });
    if (res.ok) onChanged();
  }

  async function deleteSender() {
    if (!confirm(`Opravdu smazat odesílatele „${sender.name}"? Dopisy s ním vytvořené zůstanou (mají snapshot).`)) return;
    const res = await fetch(`/api/letters/senders/${sender.id}`, { method: "DELETE" });
    if (res.ok) onChanged();
  }

  return (
    <div className="px-4 py-4 border-t border-white/5 space-y-4">
      {/* Šablona dopisu */}
      <div className="space-y-1">
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono block">
          Typ dopisu (šablona PDF)
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setTheme("classic")}
            className={`text-left rounded-md border p-3 transition-colors ${
              theme === "classic"
                ? "border-[var(--c)] bg-[color-mix(in_oklch,var(--c)_10%,transparent)]"
                : "border-white/10 hover:bg-white/5"
            }`}
          >
            <div className="text-sm font-medium">Profesionální</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Adresát vpravo, plná patička (IČ, DIČ, č.ú.).
            </div>
          </button>
          <button
            type="button"
            onClick={() => setTheme("personal")}
            className={`text-left rounded-md border p-3 transition-colors ${
              theme === "personal"
                ? "border-[var(--c)] bg-[color-mix(in_oklch,var(--c)_10%,transparent)]"
                : "border-white/10 hover:bg-white/5"
            }`}
          >
            <div className="text-sm font-medium">Osobní</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Bez adresáta v hlavičce, patička bez IČ/DIČ/č.ú.
            </div>
          </button>
        </div>
      </div>

      {/* Loga */}
      <div className="grid grid-cols-2 gap-3">
        <UploadSlot
          label="Logo"
          icon={ImageIcon}
          path={sender.logoPath}
          onUpload={(f) => uploadFile("logo", f)}
          onRemove={() => removeFile("logo")}
          inputRef={logoRef}
        />
        <UploadSlot
          label="Sken podpisu"
          icon={PenTool}
          path={sender.signaturePath}
          onUpload={(f) => uploadFile("signature", f)}
          onRemove={() => removeFile("signature")}
          inputRef={sigRef}
        />
      </div>

      {/* Pojmenování + identifikace */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Pojmenování (interní)">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Plný název do hlavičky">
          <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Petr Gideon Peřina, OSVČ / ABC s.r.o." />
        </Field>
        <Field label="IČO"><Input value={ico} onChange={(e) => setIco(e.target.value)} /></Field>
        <Field label="DIČ"><Input value={dic} onChange={(e) => setDic(e.target.value)} /></Field>
      </div>

      <Field label="Adresa (každý řádek = jedna řádka v hlavičce)">
        <textarea
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 focus:border-primary focus:outline-none text-sm font-mono resize-none"
        />
      </Field>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="E-mail"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Telefon"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Web"><Input value={web} onChange={(e) => setWeb(e.target.value)} /></Field>
        <Field label="Bankovní účet"><Input value={bank} onChange={(e) => setBank(e.target.value)} /></Field>
      </div>

      {/* AI prompt */}
      <Field
        label={
          <span className="flex items-center gap-1.5">
            <Wand2 className="size-3" /> AI prompt pro „Učesat"
          </span>
        }
        hint='Tento prompt se použije, kdykoli klikneš v dopisu na „Učesat". Při vytváření dopisu si ho můžeš ad-hoc rozšířit.'
      >
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={5}
          className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 focus:border-primary focus:outline-none text-sm resize-none"
        />
        <button
          type="button"
          onClick={() => setPrompt(DEFAULT_PROMPT)}
          className="mt-1 text-[11px] font-mono text-muted-foreground hover:text-foreground"
        >
          ↺ vrátit default
        </button>
      </Field>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2">{error}</div>
      )}

      <div className="flex gap-2 pt-2 border-t border-white/5">
        <Button onClick={save} disabled={saving}>
          {saving ? <><Loader2 className="animate-spin" /> Ukládám…</> : <><Save /> Uložit</>}
        </Button>
        {savedAt && Date.now() - savedAt < 3000 && (
          <span className="self-center text-xs font-mono text-[var(--tint-sage)]">Uloženo </span>
        )}
        <Button variant="ghost" onClick={deleteSender} className="ml-auto">
          <Trash2 /> Smazat odesílatele
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono block">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}

function UploadSlot({
  label,
  icon: Icon,
  path,
  onUpload,
  onRemove,
  inputRef,
}: {
  label: string;
  icon: typeof ImageIcon;
  path: string | null;
  onUpload: (f: File) => void;
  onRemove: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="rounded-md border border-white/10 p-3 flex items-center gap-3">
      <div className="size-14 rounded bg-white/5 grid place-items-center overflow-hidden shrink-0">
        {path ? (
          <img
            src={`/api/uploads/${encodeURIComponent(path)}`}
            alt={label}
            className="max-w-full max-h-full object-contain"
          />
        ) : (
          <Icon className="size-5 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-[11px] text-muted-foreground/80 truncate">
          {path ? "nahráno" : "PNG / JPG, max 4 MB"}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
          <Upload className="size-3" />
        </Button>
        {path && (
          <button
            type="button"
            onClick={onRemove}
            className="p-1.5 rounded hover:bg-destructive/20 text-muted-foreground"
            title="Smazat"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        ref={inputRef}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
