import { useState, useEffect } from "react";
import { Loader2, Wand2, FileDown, Save, Trash2, RefreshCcw, ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";

interface SenderOption {
  id: string;
  name: string;
  redactPrompt: string;
}

interface RecipientOption {
  id: string;
  name: string;
  addressLines: string[];
}

interface InitialLetter {
  id: string;
  senderId: string;
  recipientId: string | null;
  recipientNameSnapshot: string | null;
  recipientAddressLinesSnapshot: string[];
  showRecipientAddress: boolean;
  letterDate: string;
  place: string | null;
  bodyRaw: string;
  bodyFinal: string;
  promptOverride: string | null;
  version: number;
  parentLetterId: string | null;
  pdfPath: string | null;
}

type Props =
  | {
      mode: "new";
      senders: SenderOption[];
      recipients: RecipientOption[];
    }
  | {
      mode: "edit";
      initialLetter: InitialLetter;
      senders: SenderOption[];
      recipients: RecipientOption[];
    };

export default function LetterEditor(props: Props) {
  const isEdit = props.mode === "edit";
  const initial = isEdit ? props.initialLetter : null;

  const [letterId, setLetterId] = useState<string | null>(initial?.id ?? null);

  const [senderId, setSenderId] = useState(initial?.senderId ?? props.senders[0]?.id ?? "");
  const sender = props.senders.find((s) => s.id === senderId);

  // Recipient: buď z knihovny nebo ad-hoc
  const [recipientMode, setRecipientMode] = useState<"library" | "adhoc">(
    initial?.recipientId ? "library" : initial?.recipientNameSnapshot ? "adhoc" : "library",
  );
  const [recipientId, setRecipientId] = useState<string>(initial?.recipientId ?? "");
  const [adhocName, setAdhocName] = useState(
    initial && !initial.recipientId ? initial.recipientNameSnapshot ?? "" : "",
  );
  const [adhocAddr, setAdhocAddr] = useState(
    initial && !initial.recipientId ? initial.recipientAddressLinesSnapshot.join("\n") : "",
  );
  const [showAddress, setShowAddress] = useState(initial?.showRecipientAddress ?? true);

  const [letterDate, setLetterDate] = useState(
    initial?.letterDate ? initial.letterDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
  );
  const [place, setPlace] = useState(initial?.place ?? "");

  const [bodyRaw, setBodyRaw] = useState(initial?.bodyRaw ?? "");
  const [bodyFinal, setBodyFinal] = useState(initial?.bodyFinal ?? "");

  const [promptOverride, setPromptOverride] = useState(initial?.promptOverride ?? "");
  const [showPrompt, setShowPrompt] = useState(false);

  const [pdfPath, setPdfPath] = useState<string | null>(initial?.pdfPath ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [redacting, setRedacting] = useState(false);
  const [showFinal, setShowFinal] = useState(false);

  // Pokud raw je prázdný a final ne (po přegenerování přijdeme s final), předvyplň raw
  useEffect(() => {
    if (isEdit && bodyFinal && !bodyRaw) {
      setBodyRaw(bodyFinal);
    }
  // eslint-disable-next-line
  }, []);

  const dirty = isEdit ? bodyRaw !== initial?.bodyRaw || bodyFinal !== initial?.bodyFinal : true;

  async function ensureLetter(): Promise<string | null> {
    // Pokud nemám ID (mode=new), vytvoř letter
    if (letterId) return letterId;

    setError(null);
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        senderId,
        recipientId: recipientMode === "library" ? recipientId || null : null,
        recipientName: recipientMode === "adhoc" ? adhocName.trim() || null : null,
        recipientAddressLines:
          recipientMode === "adhoc"
            ? adhocAddr.split("\n").map((l) => l.trim()).filter(Boolean)
            : undefined,
        showRecipientAddress: showAddress,
        letterDate: new Date(letterDate).toISOString(),
        place: place.trim() || null,
        bodyRaw: bodyRaw || "(zatím prázdné)",
        promptOverride: promptOverride.trim() || null,
      };
      const res = await fetch("/api/letters", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Vytvoření selhalo.");
        return null;
      }
      setLetterId(data.letter.id);
      // přehoď URL bez reloadu
      window.history.replaceState({}, "", `/letters/${data.letter.id}`);
      return data.letter.id as string;
    } finally {
      setSaving(false);
    }
  }

  async function save(): Promise<string | null> {
    const id = await ensureLetter();
    if (!id) return null;

    setError(null);
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        recipientId: recipientMode === "library" ? recipientId || null : null,
        recipientName: recipientMode === "adhoc" ? adhocName.trim() || null : null,
        recipientAddressLines:
          recipientMode === "adhoc"
            ? adhocAddr.split("\n").map((l) => l.trim()).filter(Boolean)
            : [],
        showRecipientAddress: showAddress,
        letterDate: new Date(letterDate).toISOString(),
        place: place.trim() || null,
        bodyRaw,
        bodyFinal: bodyFinal || bodyRaw,
        promptOverride: promptOverride.trim() || null,
      };
      const res = await fetch(`/api/letters/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Uložení selhalo.");
        return null;
      }
      setPdfPath(data.letter.pdfPath);
      return id;
    } finally {
      setSaving(false);
    }
  }

  async function redact() {
    if (!bodyRaw.trim()) {
      setError("Nejdřív napiš text dopisu.");
      return;
    }
    const id = await save();
    if (!id) return;

    setRedacting(true);
    setError(null);
    try {
      const res = await fetch(`/api/letters/${id}/redact`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bodyRaw,
          promptOverride: promptOverride.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Učesání selhalo.");
        return;
      }
      setBodyFinal(data.letter.bodyFinal);
      setShowFinal(true);
      setPdfPath(null);
    } finally {
      setRedacting(false);
    }
  }

  async function generatePdf() {
    const id = await save();
    if (!id) return;
    // Stáhnout PDF
    window.open(`/api/letters/${id}/pdf?download=1`, "_blank");
  }

  async function previewPdf() {
    const id = await save();
    if (!id) return;
    window.open(`/api/letters/${id}/pdf`, "_blank");
  }

  async function deleteLetter() {
    if (!letterId) {
      window.location.href = "/letters";
      return;
    }
    if (!confirm("Opravdu smazat tento dopis?")) return;
    const res = await fetch(`/api/letters/${letterId}`, { method: "DELETE" });
    if (res.ok) window.location.href = "/letters";
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 max-w-5xl">
      {/* Hlavní editor */}
      <div className="space-y-4 order-2 lg:order-1">
        {/* Body raw + final */}
        <div className="glass rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="font-serif text-base">Text dopisu</h3>
            <div className="ml-auto flex items-center gap-1 text-xs">
              <button
                onClick={() => setShowFinal(false)}
                className={`px-2 py-1 rounded font-mono ${
                  !showFinal ? "bg-white/10 text-foreground" : "text-muted-foreground hover:bg-white/5"
                }`}
              >
                tvůj text
              </button>
              <button
                onClick={() => setShowFinal(true)}
                disabled={!bodyFinal}
                className={`px-2 py-1 rounded font-mono ${
                  showFinal ? "bg-white/10 text-foreground" : "text-muted-foreground hover:bg-white/5"
                } disabled:opacity-40`}
              >
                učesaný
              </button>
            </div>
          </div>

          {!showFinal ? (
            <textarea
              value={bodyRaw}
              onChange={(e) => setBodyRaw(e.target.value)}
              rows={18}
              placeholder="Vážený pane …,

zde napíšeš text dopisu. Odstavce odděluj prázdným řádkem. Oslovení i závěr (S pozdravem, …) napiš sem — Gemini je zachová.

S pozdravem
Petr Gideon Peřina"
              className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 focus:border-primary focus:outline-none text-sm leading-relaxed resize-y"
            />
          ) : (
            <textarea
              value={bodyFinal}
              onChange={(e) => setBodyFinal(e.target.value)}
              rows={18}
              placeholder='Tady se objeví učesaný text po kliknutí na „Učesat".'
              className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 focus:border-primary focus:outline-none text-sm leading-relaxed resize-y"
            />
          )}
        </div>

        {/* Prompt override */}
        <div className="glass rounded-xl">
          <button
            onClick={() => setShowPrompt(!showPrompt)}
            className="w-full px-4 py-2.5 flex items-center gap-2 hover:bg-white/5 transition-colors text-left"
          >
            <Wand2 className="size-4 text-muted-foreground" />
            <span className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
              AI prompt — dodatečné instrukce
            </span>
            {showPrompt ? <ChevronDown className="size-4 ml-auto" /> : <ChevronRight className="size-4 ml-auto" />}
          </button>
          {showPrompt && (
            <div className="px-4 pb-4 space-y-2">
              <div className="text-[11px] text-muted-foreground">
                Základní prompt je u odesílatele „<strong>{sender?.name ?? "—"}</strong>". Tady ho
                můžeš jen rozšířit (např. „vypíchni klíčové body", „buď přátelštější").
              </div>
              <textarea
                value={promptOverride}
                onChange={(e) => setPromptOverride(e.target.value)}
                rows={3}
                placeholder="(volitelné) Dodatečné instrukce…"
                className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 focus:border-primary focus:outline-none text-sm resize-none"
              />
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2">{error}</div>
        )}

        {/* Akce */}
        <div className="glass rounded-xl p-3 flex flex-wrap gap-2">
          <Button onClick={redact} disabled={redacting || !bodyRaw.trim()}>
            {redacting ? <><Loader2 className="animate-spin" /> Učesávám…</> : <><Wand2 /> Učesat</>}
          </Button>
          <Button variant="outline" onClick={save} disabled={saving}>
            {saving ? <><Loader2 className="animate-spin" /> Ukládám…</> : <><Save /> Uložit</>}
          </Button>
          <Button variant="outline" onClick={previewPdf} disabled={saving}>
            <FileDown /> Náhled PDF
          </Button>
          <Button onClick={generatePdf} disabled={saving}>
            <FileDown /> Stáhnout PDF
          </Button>
          {isEdit && (
            <Button variant="ghost" onClick={deleteLetter} className="ml-auto">
              <Trash2 /> Smazat
            </Button>
          )}
        </div>

        {pdfPath && (
          <div className="text-xs font-mono text-muted-foreground">PDF cache: ✓ čerstvé</div>
        )}
      </div>

      {/* Postranní panel s metadaty */}
      <div className="space-y-3 order-1 lg:order-2">
        <div className="glass rounded-xl p-4 space-y-3" style={{ ["--c" as string]: "var(--tint-butter)" }}>
          <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Odesílatel</div>
          <select
            value={senderId}
            onChange={(e) => setSenderId(e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 text-sm"
          >
            {props.senders.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <RecipientPicker
          mode={recipientMode}
          onModeChange={setRecipientMode}
          recipients={props.recipients}
          selectedId={recipientId}
          onSelectedIdChange={setRecipientId}
          adhocName={adhocName}
          onAdhocNameChange={setAdhocName}
          adhocAddr={adhocAddr}
          onAdhocAddrChange={setAdhocAddr}
          showAddress={showAddress}
          onShowAddressChange={setShowAddress}
          onRecipientCreated={(r) => {
            // Po vytvoření v knihovně přepneme do "library" módu a vybereme.
            setRecipientMode("library");
            setRecipientId(r.id);
          }}
        />

        <div className="glass rounded-xl p-4 space-y-3">
          <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Datum a místo</div>
          <Input type="date" value={letterDate} onChange={(e) => setLetterDate(e.target.value)} />
          <Input
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            placeholder="V Praze (volitelné)"
          />
        </div>

        {isEdit && initial && initial.version > 1 && (
          <div className="glass rounded-xl p-4 text-xs font-mono text-muted-foreground space-y-1">
            <div>Verze {initial.version}</div>
            <div>parent: {initial.parentLetterId?.slice(-6) ?? "—"}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function RecipientPicker({
  mode,
  onModeChange,
  recipients,
  selectedId,
  onSelectedIdChange,
  adhocName,
  onAdhocNameChange,
  adhocAddr,
  onAdhocAddrChange,
  showAddress,
  onShowAddressChange,
  onRecipientCreated,
}: {
  mode: "library" | "adhoc";
  onModeChange: (m: "library" | "adhoc") => void;
  recipients: RecipientOption[];
  selectedId: string;
  onSelectedIdChange: (id: string) => void;
  adhocName: string;
  onAdhocNameChange: (s: string) => void;
  adhocAddr: string;
  onAdhocAddrChange: (s: string) => void;
  showAddress: boolean;
  onShowAddressChange: (b: boolean) => void;
  onRecipientCreated: (r: RecipientOption) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAddr, setNewAddr] = useState("");
  const [busy, setBusy] = useState(false);

  async function createRecipient() {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/letters/recipients", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          addressLines: newAddr.split("\n").map((l) => l.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        onRecipientCreated({
          id: data.recipient.id,
          name: data.recipient.name,
          addressLines: data.recipient.addressLines,
        });
        setAdding(false);
        setNewName("");
        setNewAddr("");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass rounded-xl p-4 space-y-3" style={{ ["--c" as string]: "var(--tint-lavender)" }}>
      <div className="flex items-center gap-2">
        <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Adresát</div>
        <div className="ml-auto flex items-center gap-1 text-[11px] font-mono">
          <button
            onClick={() => onModeChange("library")}
            className={`px-2 py-0.5 rounded ${
              mode === "library" ? "bg-white/10 text-foreground" : "text-muted-foreground hover:bg-white/5"
            }`}
          >
            knihovna
          </button>
          <button
            onClick={() => onModeChange("adhoc")}
            className={`px-2 py-0.5 rounded ${
              mode === "adhoc" ? "bg-white/10 text-foreground" : "text-muted-foreground hover:bg-white/5"
            }`}
          >
            ad-hoc
          </button>
        </div>
      </div>

      {mode === "library" ? (
        adding ? (
          <div className="space-y-2">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Jméno / firma" autoFocus />
            <textarea
              value={newAddr}
              onChange={(e) => setNewAddr(e.target.value)}
              rows={3}
              placeholder="Adresa (každý řádek = řádek)"
              className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 text-sm font-mono resize-none"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={createRecipient} disabled={busy || !newName.trim()}>
                {busy ? <Loader2 className="animate-spin" /> : <Plus />} Přidat
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Zrušit</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <select
              value={selectedId}
              onChange={(e) => onSelectedIdChange(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 text-sm"
            >
              <option value="">— vyber —</option>
              {recipients.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <button
              onClick={() => setAdding(true)}
              className="text-[11px] font-mono text-muted-foreground hover:text-foreground"
            >
              + přidat nového do knihovny
            </button>
          </div>
        )
      ) : (
        <div className="space-y-2">
          <Input
            value={adhocName}
            onChange={(e) => onAdhocNameChange(e.target.value)}
            placeholder="Jméno / firma"
          />
          <textarea
            value={adhocAddr}
            onChange={(e) => onAdhocAddrChange(e.target.value)}
            rows={3}
            placeholder="Adresa (volitelně)"
            className="w-full px-3 py-2 rounded-md bg-background/40 border border-border/60 text-sm font-mono resize-none"
          />
        </div>
      )}

      <label className="flex items-center gap-2 text-sm cursor-pointer pt-1 border-t border-white/5">
        <input
          type="checkbox"
          checked={showAddress}
          onChange={(e) => onShowAddressChange(e.target.checked)}
          className="size-4"
        />
        <span>Zobrazit i adresu adresáta v dopisu</span>
      </label>
    </div>
  );
}
