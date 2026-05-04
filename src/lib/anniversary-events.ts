/**
 * Výročí jako virtuální allDay eventy pro kalendář.
 *
 * Petr má samostatnou tabulku Anniversary (title, month, day, year?),
 * která se NEpropisuje do Google ani iCloudu — jen do Rašeliniště.
 * Pro účely zobrazení v kalendáři je převádíme na virtual eventy.
 *
 * Source = "ANNIVERSARY" (mimo CalendarSource enum, speciální marker
 * stejně jako "RITUAL"). Vykreslujeme v pink tintu s 🕯 prefixem.
 */

export interface AnniversaryRow {
  id: string;
  title: string;
  month: number; // 1-12
  day: number; // 1-31
  year: number | null; // pokud zadáno, počítáme kolikáté výročí
  note: string | null;
}

export interface AnniversaryEvent {
  id: string;
  title: string;
  source: "ANNIVERSARY";
  type: "ANNIVERSARY";
  startsAt: string;
  endsAt: string;
  allDay: true;
  locationText: null;
  description: string | null;
  prepNote: null;
  itemsToBring: null;
}

/**
 * Vyrobí virtuální events pro výročí které spadají do daného rozsahu (inclusive).
 * Vrátí jeden event per výročí per rok (pokud rozsah pokrývá víc let).
 */
export function generateAnniversaryEvents(
  anniversaries: AnniversaryRow[],
  rangeStart: Date,
  rangeEnd: Date,
): AnniversaryEvent[] {
  const events: AnniversaryEvent[] = [];

  // Přes všechny roky v rozsahu (typicky 1, někdy 2 pokud rozsah překračuje rok)
  const startYear = rangeStart.getFullYear();
  const endYear = rangeEnd.getFullYear();

  for (let year = startYear; year <= endYear; year++) {
    for (const a of anniversaries) {
      const eventDate = new Date(Date.UTC(year, a.month - 1, a.day));
      if (eventDate < rangeStart || eventDate > rangeEnd) continue;

      const yearsCount = a.year ? year - a.year : null;
      const label =
        yearsCount && yearsCount > 0 ? `🕯 ${yearsCount}. ${a.title}` : `🕯 ${a.title}`;

      // allDay event = startsAt 00:00 UTC den, endsAt 00:00 UTC další den (exclusive)
      const endDate = new Date(Date.UTC(year, a.month - 1, a.day + 1));

      events.push({
        id: `anniversary-${a.id}-${year}`,
        title: label,
        source: "ANNIVERSARY",
        type: "ANNIVERSARY",
        startsAt: eventDate.toISOString(),
        endsAt: endDate.toISOString(),
        allDay: true,
        locationText: null,
        description: a.note,
        prepNote: null,
        itemsToBring: null,
      });
    }
  }

  return events;
}
