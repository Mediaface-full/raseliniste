/**
 * Denní digest pro kolegyni (ADHD F4, Petr 2026-07-22).
 *
 * "Petr dnes dělá X, zítra Y. Potřebuje od tebe Z." — kolegyně nepotřebuje
 * vědět, na čem dělá zrovna teď; potřebuje vědět, na čem bude dělat, aby
 * mohla s předstihem připravit podklady.
 *
 * Obsah: úkoly plannedFor dnes + zítra (z /planovani), dnešní schůzky
 * z kalendáře, a sekce "Připrav prosím" = otevřené úkoly přiřazené
 * kolegyni s termínem do 7 dnů.
 */

import { prisma } from "./db";

export interface DigestContent {
  subject: string;
  text: string;
  html: string;
  isEmpty: boolean;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function buildKolegyneDigest(userId: string, digestContactId: string): Promise<DigestContent> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(today); dayAfter.setDate(dayAfter.getDate() + 2);
  const weekAhead = new Date(today); weekAhead.setDate(weekAhead.getDate() + 7);

  const [plannedToday, plannedTomorrow, meetingsToday, forColleague, projects] = await Promise.all([
    prisma.task.findMany({
      where: { userId, status: "open", plannedFor: { gte: today, lt: tomorrow } },
      select: { title: true, todoistProjectId: true, priority: true },
      orderBy: { priority: "desc" },
    }),
    prisma.task.findMany({
      where: { userId, status: "open", plannedFor: { gte: tomorrow, lt: dayAfter } },
      select: { title: true, todoistProjectId: true, priority: true },
      orderBy: { priority: "desc" },
    }),
    prisma.calendarEvent.findMany({
      where: {
        deletedRemotely: false,
        source: { not: "LOCAL_ICS" },
        allDay: false,
        AND: [{ startsAt: { gte: today } }, { startsAt: { lt: tomorrow } }],
      },
      select: { title: true, startsAt: true, endsAt: true },
      orderBy: { startsAt: "asc" },
      take: 10,
    }),
    prisma.task.findMany({
      where: {
        userId,
        status: "open",
        assignedToContactId: digestContactId,
        OR: [{ dueAt: { lte: weekAhead } }, { dueAt: null }],
      },
      select: { title: true, dueAt: true, todoistProjectId: true, priority: true },
      orderBy: [{ dueAt: "asc" }, { priority: "desc" }],
      take: 10,
    }),
    prisma.todoistProjectMirror.findMany({ where: { userId }, select: { todoistId: true, name: true } }),
  ]);

  const projectNames = new Map(projects.map((p) => [p.todoistId, p.name]));
  const taskLine = (t: { title: string; todoistProjectId?: string | null; dueAt?: Date | null }) => {
    const proj = t.todoistProjectId ? projectNames.get(t.todoistProjectId) : null;
    const due = t.dueAt ? ` (do ${t.dueAt.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" })})` : "";
    return `${t.title}${proj ? ` [${proj}]` : ""}${due}`;
  };
  const fmtT = (d: Date) => d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Prague" });

  const dateLabel = today.toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "numeric" });

  const sections: { title: string; lines: string[] }[] = [
    { title: "Petr dnes dělá", lines: plannedToday.map(taskLine) },
    { title: "Dnešní schůzky", lines: meetingsToday.map((m) => `${fmtT(m.startsAt)}–${fmtT(m.endsAt)} ${m.title}`) },
    { title: "Zítra v plánu", lines: plannedTomorrow.map(taskLine) },
    { title: "Připrav prosím / tvoje úkoly", lines: forColleague.map(taskLine) },
  ].filter((s) => s.lines.length > 0);

  const isEmpty = sections.length === 0;

  const text = isEmpty
    ? "Dnes nic naplánovaného — klidný den."
    : sections.map((s) => `${s.title.toUpperCase()}\n${s.lines.map((l) => `- ${l}`).join("\n")}`).join("\n\n");

  const html = `
<div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
  <h2 style="font-size: 18px; margin: 0 0 4px;">Denní přehled — ${esc(dateLabel)}</h2>
  <p style="font-size: 13px; color: #666; margin: 0 0 16px;">Automatický digest z Rašeliniště (plánování týdne).</p>
  ${isEmpty ? `<p>Dnes nic naplánovaného — klidný den.</p>` : sections.map((s) => `
  <h3 style="font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin: 16px 0 6px;">${esc(s.title)}</h3>
  <ul style="margin: 0; padding-left: 18px; font-size: 14px; line-height: 1.6;">
    ${s.lines.map((l) => `<li>${esc(l)}</li>`).join("\n    ")}
  </ul>`).join("\n")}
  <p style="font-size: 11px; color: #aaa; margin-top: 20px;">Odesláno automaticky každý pracovní den ráno.</p>
</div>`;

  return {
    subject: `Petrův den — ${dateLabel}`,
    text,
    html,
    isEmpty,
  };
}
