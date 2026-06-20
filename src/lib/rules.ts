import { prisma } from "./db";
import {
  getSchedulingConfig,
  type SchedulingConfig,
  dowOf,
  timeOnDate,
  minutesOfDay,
} from "./rules-config";
import type { EventTypeStr } from "./event-classifier";

/**
 * Pravidlový engine — defenzivní vrstva proti přebookování.
 *
 * Public API:
 *   evaluateSlot(input) — vrátí verdict 🟢/🟡/🔴 + konkrétní signaly
 *   listAvailableSlots(opts) — vygeneruje sloty pro booking page (klient/přítel)
 *
 * Pravidla viz brief sekce 5.2 (18 pravidel).
 */

export type Verdict = "GREEN" | "YELLOW" | "RED";
export type Severity = "INFO" | "WARNING" | "ERROR";

export interface RuleSignal {
  rule: string;          // identifier, např. "MAX_PRAGUE_PER_DAY"
  severity: Severity;
  message: string;       // český text pro UI
}

export interface EvaluateInput {
  type: EventTypeStr;
  startsAt: Date;
  endsAt: Date;
  locationName?: string | null;
  excludeEventId?: string;        // pro re-evaluaci existujícího (vyloučit ze srážek)
  bookingMode?: "CLIENT" | "FRIEND" | null;  // jen pro booking-only pravidla
}

export interface EvaluationResult {
  verdict: Verdict;
  signals: RuleSignal[];
}

// ---------------------------------------------------------------------------
// Hlavní evaluator
// ---------------------------------------------------------------------------

export async function evaluateSlot(input: EvaluateInput): Promise<EvaluationResult> {
  const cfg = await getSchedulingConfig();
  const signals: RuleSignal[] = [];

  // Načti všechny eventy v okolí dne (±1 den buffer pro buffer pravidla)
  const dayStart = startOfDay(input.startsAt);
  const dayEnd = endOfDay(input.startsAt);
  const queryFrom = new Date(dayStart.getTime() - 24 * 60 * 60 * 1000);
  const queryTo = new Date(dayEnd.getTime() + 24 * 60 * 60 * 1000);

  const calendarEvents = await prisma.calendarEvent.findMany({
    where: {
      deletedRemotely: false,
      AND: [{ endsAt: { gte: queryFrom } }, { startsAt: { lte: queryTo } }],
      ...(input.excludeEventId ? { id: { not: input.excludeEventId } } : {}),
    },
    select: {
      id: true, type: true, startsAt: true, endsAt: true, source: true, title: true,
    },
  });

  // Petr 2026-05-25: aktivní bookingy taky blokují slot, i když Google sync
  // ještě neproběhl (cron sync-calendars běží à 5 min, mezi confirmReservation
  // a dalším tickem byl slot „volný" → druhá rezervace ho znovu nabídla).
  //
  // Loadnout RESERVED/CONFIRMED invites v okně a reprezentovat je jako virtuální
  // CalendarEvent typu MEETING_*, ať padají do HARD_BUSY_OVERLAP stejně jako
  // skutečné Google eventy.
  const activeBookings = await prisma.bookingInvite.findMany({
    where: {
      status: { in: ["RESERVED", "CONFIRMED"] },
    },
    select: {
      id: true,
      status: true,
      reservedSlot: true,
      inviteeName: true,
    },
  });
  const bookingPseudoEvents = activeBookings
    .map((b) => {
      const slot = b.reservedSlot as { startsAt?: string; endsAt?: string; type?: string } | null;
      if (!slot?.startsAt || !slot?.endsAt) return null;
      const startsAt = new Date(slot.startsAt);
      const endsAt = new Date(slot.endsAt);
      if (isNaN(startsAt.getTime()) || isNaN(endsAt.getTime())) return null;
      if (endsAt < queryFrom || startsAt > queryTo) return null;
      const t = (slot.type ?? "MEETING_ONLINE") as typeof calendarEvents[number]["type"];
      return {
        id: `booking:${b.id}`,
        type: t,
        startsAt,
        endsAt,
        source: "GOOGLE_PRIMARY" as typeof calendarEvents[number]["source"],
        title: b.inviteeName ? `Booking — ${b.inviteeName}` : "Booking (rezervováno)",
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  const sameWindow = [...calendarEvents, ...bookingPseudoEvents];

  // Eventy v daný den (pro per-day count pravidla)
  const sameDay = sameWindow.filter((e) =>
    !(e.endsAt < dayStart || e.startsAt > dayEnd),
  );

  // ---- HARD pravidla (ERROR) ----

  // HARD_HOCKEY_BLOCK: překryv s HOCKEY_SON
  for (const e of sameWindow) {
    if (e.type === "HOCKEY_SON" && overlap(e.startsAt, e.endsAt, input.startsAt, input.endsAt)) {
      signals.push({
        rule: "HARD_HOCKEY_BLOCK",
        severity: "ERROR",
        message: `Konflikt s hokejem syna (${fmtTime(e.startsAt)}–${fmtTime(e.endsAt)}).`,
      });
      break;
    }
  }

  // HARD_BUSY_OVERLAP: generický overlap check — JAKÝKOLI event v kalendáři blokuje slot,
  // kromě explicit whitelistu „neblokujících" typů. Bez tohoto pravidla booking
  // ignoroval cokoli, co nebylo HOCKEY_SON/OOO_* (PERSONAL, ICLOUD_SON, WORK,
  // klasifikace selhala u text-only eventů) — viz bug 2026-05-12 kdy /schuzka
  // nabídla online středu odpoledne přestože Petr měl událost se synem.
  //
  // Whitelist (neblokuje):
  //  - PARTNER_SHIFT     — info, partnerka pracuje, Petr je doma
  //  - PARTNER_VACATION  — info, partnerka mimo
  //  - OOO_TRAVEL_WORKING + slot je MEETING_ONLINE — pracuje z dovolené
  //
  // Vše ostatní (PERSONAL, WORK, FOCUS, ICLOUD_SON, MEETING_*, atd.) overlap → ERROR.
  // HOCKEY_SON / OOO_FULL už mají svá specifická pravidla výše, ale tady taky padnou
  // jako defense-in-depth (kdyby se HOCKEY_RE regex netrefil).
  {
    const NON_BLOCKING: ReadonlySet<string> = new Set([
      "PARTNER_SHIFT",
      "PARTNER_VACATION",
    ]);
    for (const e of sameWindow) {
      if (NON_BLOCKING.has(e.type)) continue;
      // OOO_TRAVEL_WORKING blokuje jen prezenční, online ne (řeší HARD_OOO_TRAVEL_INPERSON výše)
      if (e.type === "OOO_TRAVEL_WORKING" && input.type === "MEETING_ONLINE") continue;
      if (!overlap(e.startsAt, e.endsAt, input.startsAt, input.endsAt)) continue;
      // Skip když už existuje specifický signál pro tenhle event (HOCKEY/OOO_FULL výše)
      const alreadyFlagged =
        signals.some((s) =>
          s.rule === "HARD_HOCKEY_BLOCK" ||
          s.rule === "HARD_OOO_FULL" ||
          s.rule === "HARD_OOO_TRAVEL_INPERSON",
        );
      if (alreadyFlagged) break;
      signals.push({
        rule: "HARD_BUSY_OVERLAP",
        severity: "ERROR",
        message: `V kalendáři už máš „${e.title}" (${fmtTime(e.startsAt)}–${fmtTime(e.endsAt)}).`,
      });
      break;
    }
  }

  // HARD_OOO_FULL: během Petrovy dovolené
  for (const e of sameWindow) {
    if (e.type === "OOO_FULL" && overlap(e.startsAt, e.endsAt, input.startsAt, input.endsAt)) {
      signals.push({
        rule: "HARD_OOO_FULL",
        severity: "ERROR",
        message: `Máš dovolenou (${e.title}).`,
      });
      break;
    }
  }

  // HARD_OOO_TRAVEL_INPERSON: nomád období + prezenční
  if (isInPerson(input.type)) {
    for (const e of sameWindow) {
      if (e.type === "OOO_TRAVEL_WORKING" && overlap(e.startsAt, e.endsAt, input.startsAt, input.endsAt)) {
        signals.push({
          rule: "HARD_OOO_TRAVEL_INPERSON",
          severity: "ERROR",
          message: `Jsi v nomád režimu (${e.title}) — prezenční nelze, online OK.`,
        });
        break;
      }
    }
  }

  // HARD_DAY_RESTRICTION_PRAGUE
  if (input.type === "MEETING_PRAGUE") {
    const dow = dowOf(input.startsAt);
    if (!cfg.pragueDays.includes(dow)) {
      signals.push({
        rule: "HARD_DAY_RESTRICTION_PRAGUE",
        severity: "ERROR",
        message: `Praha jen úterý/středa. Ten den (${czDay(dow)}) bys neměl jezdit.`,
      });
    }
  }

  // HARD_DAY_RESTRICTION_HOME
  if (input.type === "MEETING_HOME") {
    const dow = dowOf(input.startsAt);
    if (!cfg.homeDays.includes(dow)) {
      signals.push({
        rule: "HARD_DAY_RESTRICTION_HOME",
        severity: "ERROR",
        message: `Doma jen pondělí/čtvrtek/pátek. Ten den (${czDay(dow)}) ne.`,
      });
    }
  }

  // HARD_DAY_RESTRICTION_LUNCH (Petr 2026-06-19)
  if (input.type === "MEETING_LUNCH_PRAGUE") {
    const dow = dowOf(input.startsAt);
    if (!cfg.lunchBookingDays.includes(dow)) {
      signals.push({
        rule: "HARD_DAY_RESTRICTION_LUNCH",
        severity: "ERROR",
        message: `Pracovní oběd v Praze nemáš v tento den (${czDay(dow)}) povolený.`,
      });
    }
  }

  // HARD_ONLINE_HOURS
  if (input.type === "MEETING_ONLINE") {
    const startMin = minutesOfDay(input.startsAt);
    const endMin = minutesOfDay(input.endsAt);
    const winStart = hhmmToMin(cfg.onlineHours.start);
    const winEnd = hhmmToMin(cfg.onlineHours.end);
    if (startMin < winStart || endMin > winEnd) {
      signals.push({
        rule: "HARD_ONLINE_HOURS",
        severity: "ERROR",
        message: `Online jen ${cfg.onlineHours.start}–${cfg.onlineHours.end}. Tvůj slot ${fmtTime(input.startsAt)}–${fmtTime(input.endsAt)} je mimo.`,
      });
    }
  }

  // ---- WARNING pravidla (per-day counters) ----

  const pragueCount = sameDay.filter((e) => e.type === "MEETING_PRAGUE").length;
  const inPersonCount = sameDay.filter((e) => isInPerson(e.type)).length;
  const onlineCount = sameDay.filter((e) => e.type === "MEETING_ONLINE").length;

  // Po přidání tohoto eventu:
  const newPrague = pragueCount + (input.type === "MEETING_PRAGUE" ? 1 : 0);
  const newInPerson = inPersonCount + (isInPerson(input.type) ? 1 : 0);
  const newOnline = onlineCount + (input.type === "MEETING_ONLINE" ? 1 : 0);

  if (newPrague > cfg.maxPragueWarning) {
    signals.push({
      rule: "MAX_PRAGUE_PER_DAY",
      severity: "WARNING",
      message: `${newPrague} schůzky v Praze v jednom dni.`,
    });
  }

  if (newInPerson > cfg.maxInPersonError) {
    signals.push({
      rule: "MAX_INPERSON_PER_DAY",
      severity: "ERROR",
      message: `${newInPerson} prezenčních schůzek v dni — nezvládneš.`,
    });
  } else if (newInPerson > cfg.maxInPersonWarning) {
    signals.push({
      rule: "MAX_INPERSON_PER_DAY",
      severity: "WARNING",
      message: `${newInPerson} prezenčních v dni — hodně.`,
    });
  }

  if (newOnline > cfg.maxOnlineWarning) {
    signals.push({
      rule: "MAX_ONLINE_PER_DAY",
      severity: "WARNING",
      message: `${newOnline} online schůzek v dni — pozor na únavu.`,
    });
  }

  // WEIGHTED_DAILY_LOAD: prezenční=1.0, online=0.6
  const weight = (t: EventTypeStr) =>
    isInPerson(t) ? 1.0 : t === "MEETING_ONLINE" ? 0.6 : 0;
  const newLoad =
    sameDay.reduce((sum, e) => sum + weight(e.type as EventTypeStr), 0) + weight(input.type);
  if (newLoad > cfg.weightedLoadError) {
    signals.push({
      rule: "WEIGHTED_DAILY_LOAD",
      severity: "ERROR",
      message: `Hybridní zátěž ${newLoad.toFixed(1)} (prez=1, online=0.6) — moc.`,
    });
  } else if (newLoad > cfg.weightedLoadWarning) {
    signals.push({
      rule: "WEIGHTED_DAILY_LOAD",
      severity: "WARNING",
      message: `Hybridní zátěž ${newLoad.toFixed(1)} — blížíš se limitu.`,
    });
  }

  // BUFFER_BEFORE_PRAGUE: <60 min před cestou do Prahy něco
  if (input.type === "MEETING_PRAGUE") {
    const bufferStart = new Date(input.startsAt.getTime() - cfg.bufferPragueMinutes * 60 * 1000);
    const conflict = sameWindow.find(
      (e) =>
        e.type !== "PARTNER_SHIFT" &&
        e.type !== "PARTNER_VACATION" &&
        e.type !== "OOO_FULL" &&
        e.type !== "PERSONAL" &&
        overlap(e.startsAt, e.endsAt, bufferStart, input.startsAt),
    );
    if (conflict) {
      signals.push({
        rule: "BUFFER_BEFORE_PRAGUE",
        severity: "WARNING",
        message: `Méně než ${cfg.bufferPragueMinutes} min před Prahou: „${conflict.title}".`,
      });
    }
  }

  // BUFFER_BETWEEN_ONLINE
  if (input.type === "MEETING_ONLINE") {
    const buf = cfg.bufferOnlineBetweenMinutes * 60 * 1000;
    const conflict = sameWindow.find(
      (e) =>
        e.type === "MEETING_ONLINE" &&
        (Math.abs(e.endsAt.getTime() - input.startsAt.getTime()) < buf ||
          Math.abs(input.endsAt.getTime() - e.startsAt.getTime()) < buf),
    );
    if (conflict) {
      signals.push({
        rule: "BUFFER_BETWEEN_ONLINE",
        severity: "WARNING",
        message: `Méně než ${cfg.bufferOnlineBetweenMinutes} min mezi online schůzkami („${conflict.title}").`,
      });
    }
  }

  // LUNCH_BREAK: překryv s 12:00–13:00
  const lunchStart = timeOnDate(input.startsAt, cfg.lunchBreak.start);
  const lunchEnd = timeOnDate(input.startsAt, cfg.lunchBreak.end);
  if (overlap(lunchStart, lunchEnd, input.startsAt, input.endsAt)) {
    signals.push({
      rule: "LUNCH_BREAK",
      severity: "WARNING",
      message: `Slot zasahuje do oběda (${cfg.lunchBreak.start}–${cfg.lunchBreak.end}).`,
    });
  }

  // END_OF_DAY: po 18:00
  const eod = hhmmToMin(cfg.endOfDay);
  if (minutesOfDay(input.startsAt) >= eod) {
    signals.push({
      rule: "END_OF_DAY",
      severity: "WARNING",
      message: `Začátek po ${cfg.endOfDay} — pozdě.`,
    });
  }

  // PARTNER_SHIFT_HOME: doma + partnerka má NOCNI/DENNI
  if (input.type === "MEETING_HOME") {
    const partnerShift = sameDay.find((e) => e.type === "PARTNER_SHIFT");
    if (partnerShift) {
      signals.push({
        rule: "PARTNER_SHIFT_HOME",
        severity: "WARNING",
        message: `Partnerka má dnes „${partnerShift.title}" — pozor na rušení doma.`,
      });
    }
  }

  // PARTNER_VACATION (info)
  const partnerVacation = sameDay.find((e) => e.type === "PARTNER_VACATION");
  if (partnerVacation) {
    signals.push({
      rule: "PARTNER_VACATION",
      severity: "INFO",
      message: `Partnerka má dovolenou — sám se synem (${partnerVacation.title}).`,
    });
  }

  // ---- BOOKING-only pravidla ----

  if (input.bookingMode) {
    const now = new Date();
    const leadHours = (input.startsAt.getTime() - now.getTime()) / (60 * 60 * 1000);
    const minLead =
      input.bookingMode === "CLIENT"
        ? cfg.minLeadTimeClientHours
        : cfg.minLeadTimeFriendHours;
    if (leadHours < minLead) {
      signals.push({
        rule: "MIN_LEAD_TIME",
        severity: "ERROR",
        message: `Booking ${input.bookingMode === "CLIENT" ? "klienta" : "přítele"} musí být s předstihem ${minLead} h. Tvůj slot je za ${leadHours.toFixed(1)} h.`,
      });
    }

    // OUTSIDE_AVAILABILITY: zkontroluj že je v okně dle typu
    if (!isWithinAvailability(input.type, input.startsAt, input.endsAt, cfg)) {
      signals.push({
        rule: "OUTSIDE_AVAILABILITY",
        severity: "ERROR",
        message: `Slot je mimo definovaná booking okna (${input.type}).`,
      });
    }
  }

  return { verdict: aggregate(signals), signals };
}

// ---------------------------------------------------------------------------
// listAvailableSlots — pro booking page
// ---------------------------------------------------------------------------

export interface AvailabilityOpts {
  meetingTypes: EventTypeStr[];   // např. ["MEETING_PRAGUE"] nebo ["MEETING_ONLINE", "MEETING_HOME"]
  bookingMode: "CLIENT" | "FRIEND";
  horizonDays?: number;
  slotDurationMinutes?: number;
  /**
   * Petr 2026-05-25: per-invite earliest start. Pokud nastaveno, použije se
   * MAX(now + leadTime, earliestSlotStart) — přísnější z obou vyhrává.
   */
  earliestSlotStart?: Date;
}

export interface Slot {
  startsAt: Date;
  endsAt: Date;
  type: EventTypeStr;
}

export async function listAvailableSlots(opts: AvailabilityOpts): Promise<Slot[]> {
  const cfg = await getSchedulingConfig();
  const horizon = opts.horizonDays ?? cfg.maxBookingHorizonDays;
  const dur = (opts.slotDurationMinutes ?? 60) * 60 * 1000;

  const slots: Slot[] = [];
  const now = new Date();
  const minLead =
    opts.bookingMode === "CLIENT"
      ? cfg.minLeadTimeClientHours
      : cfg.minLeadTimeFriendHours;
  const leadEarliest = new Date(now.getTime() + minLead * 60 * 60 * 1000);
  // Petr 2026-05-25: respektovat per-invite availableFrom — přísnější z obou platí.
  const earliest = opts.earliestSlotStart && opts.earliestSlotStart > leadEarliest
    ? opts.earliestSlotStart
    : leadEarliest;
  const latest = new Date(now.getTime() + horizon * 24 * 60 * 60 * 1000);

  for (let day = new Date(earliest); day <= latest; day = addDays(day, 1)) {
    for (const type of opts.meetingTypes) {
      const dayConfig = availabilityForType(type, cfg);
      if (!dayConfig) continue;
      if (!dayConfig.days.includes(dowOf(day))) continue;

      // Generuj hodinové sloty v rámci okna
      const winStart = timeOnDate(day, dayConfig.start);
      const winEnd = timeOnDate(day, dayConfig.end);
      for (let s = new Date(winStart); s.getTime() + dur <= winEnd.getTime(); s = new Date(s.getTime() + dur)) {
        const e = new Date(s.getTime() + dur);
        if (s < earliest) continue;

        // Vyhodnoť slot
        const result = await evaluateSlot({
          type,
          startsAt: s,
          endsAt: e,
          bookingMode: opts.bookingMode,
        });

        // Pro booking nabídneme jen GREEN
        if (result.verdict === "GREEN") {
          slots.push({ startsAt: new Date(s), endsAt: new Date(e), type });
        }
      }
    }
  }

  return slots;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function aggregate(signals: RuleSignal[]): Verdict {
  if (signals.some((s) => s.severity === "ERROR")) return "RED";
  if (signals.some((s) => s.severity === "WARNING")) return "YELLOW";
  return "GREEN";
}

function isInPerson(t: EventTypeStr): boolean {
  return t === "MEETING_PRAGUE" || t === "MEETING_HOME" || t === "MEETING_ELSEWHERE" || t === "MEETING_LUNCH_PRAGUE";
}

function overlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function endOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", hour12: false });
}

const CZ_DAYS = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];
function czDay(dow: number): string {
  return CZ_DAYS[dow] ?? `den ${dow}`;
}

function availabilityForType(t: EventTypeStr, cfg: SchedulingConfig) {
  if (t === "MEETING_PRAGUE") return { days: cfg.pragueDays, ...cfg.pragueHours };
  if (t === "MEETING_HOME") return { days: cfg.homeDays, ...cfg.homeHours };
  if (t === "MEETING_ONLINE") return { days: cfg.onlineDays, ...cfg.onlineHours };
  if (t === "MEETING_LUNCH_PRAGUE") return { days: cfg.lunchBookingDays, ...cfg.lunchBookingHours };
  return null;
}

function isWithinAvailability(
  t: EventTypeStr,
  startsAt: Date,
  endsAt: Date,
  cfg: SchedulingConfig,
): boolean {
  const a = availabilityForType(t, cfg);
  if (!a) return true; // pro typy bez definice (PERSONAL, OTHER, …) neblokujeme
  if (!a.days.includes(dowOf(startsAt))) return false;
  const startMin = minutesOfDay(startsAt);
  const endMin = minutesOfDay(endsAt);
  return startMin >= hhmmToMin(a.start) && endMin <= hhmmToMin(a.end);
}
