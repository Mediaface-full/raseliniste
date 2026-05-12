import { useState, useEffect, useRef } from "react";
import { Loader2, Check, AlertTriangle, Calendar, MapPin, Video, Home } from "lucide-react";

interface Slot {
  startsAt: string;
  endsAt: string;
  type: string;
}
interface Invite {
  id: string;
  mode: string;
  meetingType: string;
  slotDurationMin: number;
  status: string;
  validUntil: string;
  inviteeName: string | null;
  inviteeEmail: string | null;
  requiresIdentification: boolean;
}

export default function BookingPicker({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [filter, setFilter] = useState<string>("ALL");

  const [chosenSlot, setChosenSlot] = useState<Slot | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [subject, setSubject] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // Mobile UX: po vybrání slotu rolovat dolů na form, ať uživatel
  // vidí, že je třeba doplnit jméno/e-mail/téma. Bez toho lidé kliknou
  // hodinu a nevšimnou si, že form je úplně pod fold.
  const formRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (chosenSlot && formRef.current) {
      formRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      // Focus na první vyplnitelný input (jen u univerzálního invite)
      if (invite?.requiresIdentification) {
        setTimeout(() => {
          const firstInput = formRef.current?.querySelector<HTMLInputElement>("input:not([disabled])");
          firstInput?.focus({ preventScroll: true });
        }, 300);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosenSlot]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/booking/by-token/${token}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Pozvánka nebyla nalezena.");
        return;
      }
      setInvite(data.invite);
      setSlots(data.slots);
      if (data.invite.inviteeName) setName(data.invite.inviteeName);
      if (data.invite.inviteeEmail) setEmail(data.invite.inviteeEmail);
    } finally {
      setLoading(false);
    }
  }

  async function reserve() {
    if (!chosenSlot) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        token,
        slot: chosenSlot,
        ...(invite?.requiresIdentification && {
          inviteeName: name,
          inviteeEmail: email,
          inviteePhone: phone || undefined,
          inviteeSubject: subject || undefined,
        }),
      };
      const res = await fetch("/api/booking/reserve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Rezervace selhala.");
        return;
      }
      setDone(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="text-center py-12 text-muted-foreground"><Loader2 className="size-8 animate-spin mx-auto mb-2" /> Načítám…</div>;
  }
  if (error && !invite) {
    return (
      <div className="glass-strong rounded-xl p-8 text-center">
        <AlertTriangle className="size-12 text-destructive mx-auto mb-3" />
        <h1 className="font-serif text-xl mb-2">Pozvánka neexistuje</h1>
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }
  if (!invite) return null;

  // Stavy invite
  if (invite.status === "CONFIRMED") {
    return centerCard("✓", "Termín už je potvrzený", "Zkontroluj e-mail nebo Google Calendar.");
  }
  if (invite.status === "CANCELED") {
    return centerCard("⊘", "Pozvánka byla zrušena", "Pošlu ti novou.");
  }
  if (invite.status === "EXPIRED" || new Date(invite.validUntil) < new Date()) {
    return centerCard("⌛", "Pozvánka už neplatí", "Pošlu ti novou.");
  }

  if (done) {
    return centerCard("✓", "Termín potvrzen",
      `Pozvánka přijde mailem z Google Kalendáře${email ? ` na ${email}` : ""}.`);
  }

  // Group sloty po dnech
  const filteredSlots = filter === "ALL" ? slots : slots.filter((s) => s.type === filter);
  const slotsByDay = new Map<string, Slot[]>();
  for (const s of filteredSlots) {
    const day = s.startsAt.slice(0, 10);
    if (!slotsByDay.has(day)) slotsByDay.set(day, []);
    slotsByDay.get(day)!.push(s);
  }

  const showFilter = invite.meetingType === "CHOICE_ANY" && filteredSlots.length > 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-2xl">Volba termínu</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Délka: <span className="font-mono">{invite.slotDurationMin} min</span>.
        </p>
      </div>

      {showFilter && (
        <div className="flex gap-2 flex-wrap">
          <FilterChip active={filter === "ALL"} onClick={() => setFilter("ALL")}>Vše</FilterChip>
          <FilterChip active={filter === "MEETING_PRAGUE"} onClick={() => setFilter("MEETING_PRAGUE")}>
            <MapPin className="size-3" /> Praha
          </FilterChip>
          <FilterChip active={filter === "MEETING_ONLINE"} onClick={() => setFilter("MEETING_ONLINE")}>
            <Video className="size-3" /> Online
          </FilterChip>
          <FilterChip active={filter === "MEETING_HOME"} onClick={() => setFilter("MEETING_HOME")}>
            <Home className="size-3" /> Doma
          </FilterChip>
        </div>
      )}

      {filteredSlots.length === 0 ? (
        <div className="glass rounded-xl p-6 text-center text-sm text-muted-foreground">
          Žádný volný termín. Pro domluvu napište mailem.
        </div>
      ) : (
        <div className="space-y-4">
          {Array.from(slotsByDay.entries()).slice(0, 14).map(([day, daySlots]) => {
            const dateObj = new Date(`${day}T00:00:00`);
            const label = dateObj.toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "long" });
            return (
              <div key={day} className="glass rounded-xl p-4">
                <div className="text-xs uppercase tracking-widest font-mono text-muted-foreground mb-2">{label}</div>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {daySlots.map((s, i) => {
                    const start = new Date(s.startsAt);
                    const time = start.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
                    const isPicked = chosenSlot?.startsAt === s.startsAt && chosenSlot?.type === s.type;
                    return (
                      <button
                        key={i}
                        onClick={() => setChosenSlot(s)}
                        className={`rounded-md border p-2 text-sm font-mono transition ${
                          isPicked
                            ? "border-[var(--tint-sage)] bg-[var(--tint-sage)]/15"
                            : "border-white/10 hover:border-white/30 hover:bg-white/5"
                        }`}
                      >
                        <div className="font-medium">{time}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{typeShort(s.type)}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {chosenSlot && (
        <div ref={formRef} className="glass-strong rounded-xl p-5 space-y-3" style={{ ["--c" as string]: "var(--tint-sage)" }}>
          <div className="flex items-center gap-2">
            <Calendar className="size-4" />
            <strong>Vybráno:</strong> {new Date(chosenSlot.startsAt).toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "long" })} —{" "}
            {new Date(chosenSlot.startsAt).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}–
            {new Date(chosenSlot.endsAt).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}
          </div>

          {invite.requiresIdentification && (
            <div className="space-y-2 pt-2 border-t border-white/5">
              <div>
                <label className="text-xs font-mono uppercase text-muted-foreground">Jméno *</label>
                <input value={name} onChange={(e) => setName(e.target.value)} required
                  className="w-full px-3 py-2 rounded-md bg-black/30 border border-white/10 text-sm" />
              </div>
              <div>
                <label className="text-xs font-mono uppercase text-muted-foreground">E-mail *</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                  className="w-full px-3 py-2 rounded-md bg-black/30 border border-white/10 text-sm" />
              </div>
              <div>
                <label className="text-xs font-mono uppercase text-muted-foreground">Telefon (volitelně)</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2 rounded-md bg-black/30 border border-white/10 text-sm" />
              </div>
              <div>
                <label className="text-xs font-mono uppercase text-muted-foreground">Téma *</label>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} required
                  placeholder="Krátká věta — o čem schůzka bude"
                  className="w-full px-3 py-2 rounded-md bg-black/30 border border-white/10 text-sm" />
              </div>
            </div>
          )}

          <button
            onClick={reserve}
            disabled={submitting || (invite.requiresIdentification && (!name || !email || !subject))}
            className="w-full mt-2 px-4 py-3 rounded-md bg-[var(--tint-sage)] text-black font-medium flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {submitting ? <><Loader2 className="size-4 animate-spin" /> Rezervuji…</> : <><Check className="size-4" /> Rezervovat termín</>}
          </button>
          <p className="text-xs text-muted-foreground text-center">Po kliknutí se termín zapíše do kalendáře. Potvrzení přijde mailem.</p>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 text-sm px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-mono flex items-center gap-1 transition ${
        active ? "bg-foreground text-background" : "bg-white/5 hover:bg-white/10 text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function typeShort(t: string): string {
  if (t === "MEETING_PRAGUE") return "Praha";
  if (t === "MEETING_ONLINE") return "online";
  if (t === "MEETING_HOME") return "doma";
  return t;
}

function centerCard(icon: string, title: string, body: string) {
  return (
    <div className="glass-strong rounded-xl p-8 text-center">
      <div className="text-5xl mb-3">{icon}</div>
      <h1 className="font-serif text-xl mb-2">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
