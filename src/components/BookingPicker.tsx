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
  publicNote?: string | null;
}

export default function BookingPicker({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [filter, setFilter] = useState<string>("ALL");

  const [chosenSlot, setChosenSlot] = useState<Slot | null>(null);
  // Petr 2026-06-10: rozdělit jméno na 2 pole pro celé jméno v Calendar event title.
  // Předchozí UX: jedno pole „Jméno *" → host často zadal jen křestní, Google
  // event title pak „🤝 Karel" místo „🤝 Karel Novák".
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  // Kombinované celé jméno pro submit
  const name = `${firstName.trim()} ${lastName.trim()}`.trim();
  function setName(v: string) {
    // Když API vrátí existující inviteeName (pre-fill), rozdělit na první/zbytek
    const parts = v.trim().split(/\s+/);
    if (parts.length >= 2) {
      setFirstName(parts[0]);
      setLastName(parts.slice(1).join(" "));
    } else {
      setFirstName(v);
      setLastName("");
    }
  }
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [subject, setSubject] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  // Petr 2026-05-25: confirmation screen ukazuje detaily místo holé hlášky
  // — reserve.ts vrátí meetLink, my zachytíme + zobrazíme v rich card.
  const [confirmedMeetLink, setConfirmedMeetLink] = useState<string | null>(null);
  const [confirmedSlot, setConfirmedSlot] = useState<Slot | null>(null);

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
      setConfirmedSlot(chosenSlot);
      setConfirmedMeetLink(data.meetLink ?? null);
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

  if (done && confirmedSlot) {
    // Bohatá confirmation karta — datum, čas, Meet link (pokud byl), email
    // a kontextový info. Petr 2026-05-25: dřív tu byl jen „centerCard" se
    // suchou textovou hláškou, host si měl pozvánku hledat v mailu.
    const slotStart = new Date(confirmedSlot.startsAt);
    const slotEnd = new Date(confirmedSlot.endsAt);
    const dateStr = slotStart.toLocaleDateString("cs-CZ", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    const timeStr = `${slotStart.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}–${slotEnd.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}`;

    return (
      <div className="glass-strong rounded-2xl p-7 sm:p-9 space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center size-16 rounded-full bg-[var(--tint-sage)]/20 border border-[var(--tint-sage)]/40 mb-1">
            <Check className="size-8 text-[var(--tint-sage)]" strokeWidth={2.5} />
          </div>
          <h1 className="font-serif text-2xl">Termín potvrzen</h1>
          <p className="text-sm text-muted-foreground">Schůzka je zapsaná v kalendáři.</p>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-3">
          <div className="flex items-start gap-3">
            <Calendar className="size-5 mt-0.5 text-[var(--tint-sage)] shrink-0" />
            <div>
              <div className="text-xs font-mono uppercase text-muted-foreground tracking-wide">Termín</div>
              <div className="text-base font-medium capitalize">{dateStr}</div>
              <div className="text-base font-mono">{timeStr}</div>
            </div>
          </div>

          {confirmedMeetLink && (
            <div className="flex items-start gap-3 pt-3 border-t border-white/5">
              <Video className="size-5 mt-0.5 text-[var(--tint-sage)] shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-mono uppercase text-muted-foreground tracking-wide">Google Meet</div>
                <a
                  href={confirmedMeetLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-mono text-[var(--tint-sage)] hover:underline break-all"
                >
                  {confirmedMeetLink}
                </a>
              </div>
            </div>
          )}

          {confirmedSlot.type === "MEETING_PRAGUE" && (
            <div className="flex items-start gap-3 pt-3 border-t border-white/5">
              <MapPin className="size-5 mt-0.5 text-[var(--tint-sage)] shrink-0" />
              <div>
                <div className="text-xs font-mono uppercase text-muted-foreground tracking-wide">Místo</div>
                <div className="text-sm">Praha — přesnou adresu pošlu samostatně.</div>
              </div>
            </div>
          )}

          {confirmedSlot.type === "MEETING_HOME" && (
            <div className="flex items-start gap-3 pt-3 border-t border-white/5">
              <Home className="size-5 mt-0.5 text-[var(--tint-sage)] shrink-0" />
              <div>
                <div className="text-xs font-mono uppercase text-muted-foreground tracking-wide">Místo</div>
                <div className="text-sm">U mě doma — adresu pošlu samostatně.</div>
              </div>
            </div>
          )}
        </div>

        <div className="text-sm text-foreground/80 leading-relaxed space-y-2">
          {email && (
            <p>
              Pozvánka s kalendářovým souborem (.ics) Vám za chvíli přijde mailem na
              {" "}<span className="font-mono text-foreground">{email}</span>.
            </p>
          )}
          <p className="text-muted-foreground text-xs">
            Pokud do 5 minut nic nedorazí, mrkněte prosím do spamu. Kdyby přesto nic,
            ozvěte se na <a href="mailto:oko@raseliniste.cz" className="underline">oko@raseliniste.cz</a>.
          </p>
        </div>

        <div className="text-center pt-2 text-xs text-muted-foreground font-mono">
          Petr Peřina · raseliniste.cz
        </div>
      </div>
    );
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

  // Dynamický nadpis a popis podle typu pozvánky — ať klient hned ví o co jde.
  const titleByType: Record<string, { title: string; intro: string }> = {
    MEETING_ONLINE: {
      title: "Rezervace online schůzky",
      intro: "Vyber si termín, který ti vyhovuje. Po potvrzení ti přijde mailem pozvánka z Google Kalendáře s odkazem na videohovor.",
    },
    MEETING_PRAGUE: {
      title: "Rezervace schůzky v Praze",
      intro: "Vyber si termín. Po potvrzení ti přijde mailem pozvánka z Google Kalendáře s přesným místem.",
    },
    MEETING_HOME: {
      title: "Rezervace schůzky u mě doma",
      intro: "Vyber si termín. Po potvrzení ti přijde mailem pozvánka z Google Kalendáře s adresou.",
    },
    CHOICE_ANY: {
      title: "Rezervace schůzky",
      intro: "Vyber si formát a termín. Po potvrzení ti přijde mailem pozvánka z Google Kalendáře.",
    },
  };
  const header = titleByType[invite.meetingType] ?? titleByType.CHOICE_ANY;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-serif text-2xl">{header.title}</h1>
        <p className="text-sm text-foreground/80 mt-2 leading-relaxed">
          {header.intro}
        </p>
        <p className="text-xs text-muted-foreground mt-2 font-mono">
          Délka schůzky: {invite.slotDurationMin} min
        </p>
      </div>

      {/* Petr 2026-05-25: veřejná poznámka pro hosta — uvidí ji nahoře nad sloty */}
      {invite.publicNote && (
        <div className="glass rounded-xl p-4 border-l-4" style={{ borderLeftColor: "var(--tint-butter)" }}>
          <div className="text-xs font-mono uppercase tracking-wide text-muted-foreground mb-1">Poznámka</div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{invite.publicNote}</p>
        </div>
      )}

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
            const weekday = dateObj.toLocaleDateString("cs-CZ", { weekday: "long" });
            const dayNum = dateObj.getDate();
            const monthStr = dateObj.toLocaleDateString("cs-CZ", { month: "long" });
            const relChip = relativeDayChip(dateObj);
            // Per-weekday pastel tint — vizuální anchor, ať host hned vidí
            // o jaký den jde i bez čtení názvu. Petr 2026-05-25.
            const tint = WEEKDAY_TINTS[dateObj.getDay()];
            return (
              <div
                key={day}
                className="glass rounded-2xl overflow-hidden relative"
                style={{ ["--tint" as string]: `var(--tint-${tint})` }}
              >
                {/* Levý barevný pruh per weekday */}
                <div
                  className="absolute left-0 top-0 bottom-0 w-1.5"
                  style={{ background: `var(--tint)` }}
                />
                <div className="p-4 sm:p-5 pl-5 sm:pl-6">
                  <div className="flex items-center gap-4 mb-4">
                    {/* Velké číslo dne v měsíci */}
                    <div
                      className="flex flex-col items-center justify-center rounded-xl border border-white/10 px-3 py-2 min-w-[64px]"
                      style={{ background: `color-mix(in oklch, var(--tint) 12%, transparent)` }}
                    >
                      <span className="font-serif text-3xl leading-none">{dayNum}</span>
                      <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground mt-1">
                        {monthStr.slice(0, 3)}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-serif text-xl text-foreground capitalize leading-tight">
                          {weekday}
                        </span>
                        {relChip && (
                          <span
                            className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-white/15"
                            style={{ background: `color-mix(in oklch, var(--tint) 20%, transparent)` }}
                          >
                            {relChip}
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-mono text-muted-foreground mt-0.5">
                        {daySlots.length} {daySlots.length === 1 ? "termín" : daySlots.length < 5 ? "termíny" : "termínů"}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {daySlots.map((s, i) => {
                      const start = new Date(s.startsAt);
                      const time = start.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
                      const isPicked = chosenSlot?.startsAt === s.startsAt && chosenSlot?.type === s.type;
                      return (
                        <button
                          key={i}
                          onClick={() => setChosenSlot(s)}
                          className={`rounded-lg border p-2.5 text-sm font-mono transition active:scale-95 ${
                            isPicked
                              ? "border-[var(--tint-sage)] bg-[var(--tint-sage)]/20 shadow-[0_0_0_2px_color-mix(in_oklch,var(--tint-sage)_30%,transparent)]"
                              : "border-white/10 hover:border-white/40 hover:bg-white/5"
                          }`}
                        >
                          <div className="font-medium text-base leading-tight">{time}</div>
                          <div className="text-[10px] text-muted-foreground mt-1">{typeShort(s.type)}</div>
                        </button>
                      );
                    })}
                  </div>
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
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-mono uppercase text-muted-foreground">Jméno *</label>
                  <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required
                    placeholder="Karel"
                    className="w-full px-3 py-2 rounded-md bg-black/30 border border-white/10 text-sm" />
                </div>
                <div>
                  <label className="text-xs font-mono uppercase text-muted-foreground">Příjmení *</label>
                  <input value={lastName} onChange={(e) => setLastName(e.target.value)} required
                    placeholder="Novák"
                    className="w-full px-3 py-2 rounded-md bg-black/30 border border-white/10 text-sm" />
                </div>
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

// Pastel tints per weekday — vizuální anchor ať host na první pohled odliší dny.
// Index = getDay() (0 = neděle, 1 = pondělí, …). Pořadí ladí s dashboardem.
const WEEKDAY_TINTS = [
  "rose",     // neděle
  "peach",    // pondělí
  "lavender", // úterý
  "mint",     // středa
  "sky",      // čtvrtek
  "butter",   // pátek
  "sage",     // sobota
];

/**
 * Vrátí chip „Dnes" / „Zítra" pro dnešní/zítřejší datum, jinak null.
 * Porovnává jen Y-M-D složky, ignoruje čas.
 */
function relativeDayChip(d: Date): string | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const diffDays = Math.round((day.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return "Dnes";
  if (diffDays === 1) return "Zítra";
  return null;
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
