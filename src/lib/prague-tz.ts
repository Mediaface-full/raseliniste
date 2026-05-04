/**
 * Praha TZ helper. Server v Dockeru běží v UTC, ale rituály a UI generování
 * potřebují Praha TZ ("8:00 ráno" znamená 8:00 v Praze, ne v UTC).
 *
 * Manuální DST check (poslední neděle března 1:00 UTC → poslední neděle
 * října 1:00 UTC = CEST +2; jinak CET +1).
 */

function lastSundayOfMonth(year: number, monthOneBased: number): Date {
  // Najdi poslední neděli daného měsíce v UTC
  const lastDay = new Date(Date.UTC(year, monthOneBased, 0)); // poslední den měsíce
  const dow = lastDay.getUTCDay(); // 0 = neděle
  const offset = dow === 0 ? 0 : -dow;
  lastDay.setUTCDate(lastDay.getUTCDate() + offset);
  return lastDay;
}

/** Vrátí Praha offset od UTC (+1 nebo +2 v hodinách) pro daný moment. */
export function pragueOffsetHours(d: Date): 1 | 2 {
  const year = d.getUTCFullYear();
  const dstStart = lastSundayOfMonth(year, 3);
  dstStart.setUTCHours(1, 0, 0, 0);
  const dstEnd = lastSundayOfMonth(year, 10);
  dstEnd.setUTCHours(1, 0, 0, 0);
  return d >= dstStart && d < dstEnd ? 2 : 1;
}

/**
 * Vyrobí Date co odpovídá daným hodnotám v Praha TZ (year/month 1-based/day/h/m).
 * Příklad: pragueDate(2026, 5, 4, 8, 0) → Date odpovídající 4.5.2026 8:00 Praha
 *          (UTC stamp = 4.5.2026 06:00:00.000Z, protože květen = CEST +2)
 */
export function pragueDate(
  year: number,
  monthOneBased: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  // Předběžně spočítej offset jako kdyby moment byl ve standardním čase
  const probe = new Date(Date.UTC(year, monthOneBased - 1, day, hour, minute));
  const offset = pragueOffsetHours(probe);
  return new Date(Date.UTC(year, monthOneBased - 1, day, hour - offset, minute));
}
