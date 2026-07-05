import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { prisma } from "@/lib/db";

/**
 * Petr 2026-06-22: Tools pro ClaudeClaw Telegram bot.
 *
 * Factory funkce buildAgentTools(userId) vrací tools s userId zabudovaným
 * v closure. TS SDK betaZodTool.run nepředává custom context — closure je
 * čistší způsob.
 *
 * Každý tool je pure query nad Prisma DB — read-only, žádné mutace v MVP.
 */

function fmtDate(d: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const daysDiff = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (daysDiff === 0) return "dnes";
  if (daysDiff === 1) return "zítra";
  if (daysDiff === -1) return "včera";
  return d.toLocaleDateString("cs-CZ", { weekday: "short", day: "numeric", month: "numeric" });
}

function fmtDateTime(d: Date): string {
  const date = fmtDate(d);
  const time = d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
  return `${date} ${time}`;
}

function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function todayEnd(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

export function buildAgentTools(userId: string) {
  const getTasks = betaZodTool({
    name: "get_tasks",
    description:
      "Získá seznam Gideonových úkolů (TODO). Vždy volej pro dotazy typu: 'co mám za úkoly', 'úkoly na dnes', 'co Karel', 'nedodělané', 'zpožděné úkoly'. Vrací max 30 úkolů seřazených podle priority a deadline.",
    inputSchema: z.object({
      filter: z
        .enum(["today", "open", "overdue", "week", "all"])
        .describe(
          "today = jen dnešní deadline; open = všechny otevřené (default); overdue = po termínu; week = tento týden; all = otevřené i hotové",
        )
        .default("open"),
      contactQuery: z
        .string()
        .optional()
        .describe(
          "Jméno kontaktu (substring, case-insensitive). Použij pro 'co Karel', 'úkoly pro Lucii'.",
        ),
      tag: z.string().optional().describe("Konkrétní tag (bez #)."),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    run: async ({ filter, contactQuery, tag, limit }) => {
      const now = new Date();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: any = { userId };

      if (filter === "today") {
        where.status = "open";
        where.dueAt = { gte: todayStart(), lte: todayEnd() };
      } else if (filter === "overdue") {
        where.status = "open";
        where.dueAt = { lt: now };
      } else if (filter === "week") {
        where.status = "open";
        where.dueAt = { lte: new Date(now.getTime() + 7 * 86400000) };
      } else if (filter === "open") {
        where.status = "open";
      }

      if (tag) where.tags = { has: tag };

      if (contactQuery) {
        const contact = await prisma.contact.findFirst({
          where: { userId, displayName: { contains: contactQuery, mode: "insensitive" } },
          select: { id: true },
        });
        if (!contact) return `Kontakt "${contactQuery}" jsem nenašel.`;
        where.assignedToContactId = contact.id;
      }

      const tasks = await prisma.task.findMany({
        where,
        orderBy: [{ priority: "desc" }, { dueAt: "asc" }, { createdAt: "desc" }],
        take: limit,
        include: { assignedToContact: { select: { displayName: true } } },
      });

      if (tasks.length === 0) {
        const label =
          filter === "today"
            ? "na dnes"
            : filter === "overdue"
              ? "po termínu"
              : filter === "week"
                ? "na tento týden"
                : "";
        return `Žádné úkoly ${label}.`.trim();
      }

      const lines = tasks.map((t) => {
        const parts: string[] = [`${t.status === "done" ? "✓" : "•"} ${t.title}`];
        if (t.dueAt) parts.push(`(${fmtDateTime(t.dueAt)})`);
        if (t.priority === "high") parts.push("!");
        if (t.assignedToContact) parts.push(`→ ${t.assignedToContact.displayName}`);
        if (t.tags.length > 0) parts.push(t.tags.map((x) => `#${x}`).join(" "));
        return parts.join(" ");
      });

      return `${tasks.length} úkolů:\n${lines.join("\n")}`;
    },
  });

  const getEvents = betaZodTool({
    name: "get_events",
    description:
      "Získá události z kalendáře (Google, iCloud, Rašeliniště) pro daný rozsah. Volej pro 'co mám dnes', 'schůzky zítra', 'kalendář na týden'.",
    inputSchema: z.object({
      from: z.enum(["today", "tomorrow", "week", "month"]).default("today"),
      includeAllDay: z.boolean().default(true),
    }),
    run: async ({ from, includeAllDay }) => {
      const start = todayStart();
      let end = todayEnd();
      if (from === "tomorrow") {
        start.setDate(start.getDate() + 1);
        end = new Date(start);
        end.setHours(23, 59, 59, 999);
      } else if (from === "week") {
        end = new Date(start.getTime() + 7 * 86400000);
      } else if (from === "month") {
        end = new Date(start.getTime() + 30 * 86400000);
      }

      const events = await prisma.calendarEvent.findMany({
        where: {
          startsAt: { gte: start, lte: end },
          ...(includeAllDay ? {} : { allDay: false }),
        },
        orderBy: { startsAt: "asc" },
        take: 30,
        select: {
          title: true,
          startsAt: true,
          endsAt: true,
          allDay: true,
          locationText: true,
        },
      });

      if (events.length === 0) {
        return `Žádné události ${from === "today" ? "dnes" : from === "tomorrow" ? "zítra" : "v rozsahu"}.`;
      }

      const lines = events.map((e) => {
        const time = e.allDay
          ? "celý den"
          : `${e.startsAt.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}–${e.endsAt.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}`;
        const date = fmtDate(e.startsAt);
        const loc = e.locationText ? ` @ ${e.locationText}` : "";
        return `• ${date} ${time} — ${e.title}${loc}`;
      });

      return `${events.length} událostí:\n${lines.join("\n")}`;
    },
  });

  const getSchedule = betaZodTool({
    name: "get_schedule",
    description:
      "Komplexní přehled (události + úkoly + Studánka) pro daný den. Volej pro obecné dotazy 'co dnes', 'co je nového', 'briefing', 'program'.",
    inputSchema: z.object({
      day: z.enum(["today", "tomorrow"]).default("today"),
    }),
    run: async ({ day }) => {
      const start = todayStart();
      if (day === "tomorrow") start.setDate(start.getDate() + 1);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);

      const [events, tasks, studankaCount] = await Promise.all([
        prisma.calendarEvent.findMany({
          where: { startsAt: { gte: start, lte: end } },
          orderBy: { startsAt: "asc" },
          select: {
            title: true,
            startsAt: true,
            endsAt: true,
            allDay: true,
            locationText: true,
          },
        }),
        prisma.task.findMany({
          where: { userId, status: "open", dueAt: { gte: start, lte: end } },
          orderBy: [{ priority: "desc" }, { dueAt: "asc" }],
          take: 15,
          select: {
            title: true,
            priority: true,
            dueAt: true,
            dueIsTime: true,
            assignedToContact: { select: { displayName: true } },
          },
        }),
        prisma.projectRecording.count({
          where: {
            project: { userId },
            createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) },
            guestUserId: { not: null },
          },
        }),
      ]);

      const parts: string[] = [`# ${day === "today" ? "Dnes" : "Zítra"}`];

      if (events.length > 0) {
        parts.push("\n**Události:**");
        for (const e of events) {
          const time = e.allDay
            ? "celý den"
            : e.startsAt.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
          parts.push(`• ${time} — ${e.title}${e.locationText ? ` @ ${e.locationText}` : ""}`);
        }
      } else {
        parts.push("\nŽádné události.");
      }

      if (tasks.length > 0) {
        parts.push("\n**Úkoly:**");
        for (const t of tasks) {
          const p = t.priority === "high" ? "! " : "";
          const time =
            t.dueIsTime && t.dueAt
              ? t.dueAt.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" }) + " "
              : "";
          const who = t.assignedToContact ? ` → ${t.assignedToContact.displayName}` : "";
          parts.push(`• ${p}${time}${t.title}${who}`);
        }
      } else {
        parts.push("\nŽádné úkoly.");
      }

      if (studankaCount > 0) {
        parts.push(`\n**Studánka:** ${studankaCount} nových záznamů za 24h`);
      }

      return parts.join("\n");
    },
  });

  const getStudankaActivity = betaZodTool({
    name: "get_studanka_activity",
    description:
      "Poslední aktivita ve Studánce od hostů — nahrávky, dokumenty. Volej pro 'co je nového ve Studánce', 'co Karel poslal', 'nové nahrávky'.",
    inputSchema: z.object({
      hours: z.number().int().min(1).max(720).default(48).describe("Kolik hodin zpět"),
      projectQuery: z.string().optional().describe("Filtr na název projektu (substring)"),
    }),
    run: async ({ hours, projectQuery }) => {
      const since = new Date(Date.now() - hours * 3600 * 1000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const projectWhere: any = { userId };
      if (projectQuery) {
        projectWhere.name = { contains: projectQuery, mode: "insensitive" };
      }

      const [recordings, files] = await Promise.all([
        prisma.projectRecording.findMany({
          where: { createdAt: { gte: since }, project: projectWhere },
          orderBy: { createdAt: "desc" },
          take: 15,
          include: {
            project: { select: { name: true } },
            guestUser: { select: { name: true } },
          },
        }),
        prisma.projectFile.findMany({
          where: {
            uploadedAt: { gte: since },
            project: projectWhere,
            guestUserId: { not: null },
          },
          orderBy: { uploadedAt: "desc" },
          take: 15,
          include: {
            project: { select: { name: true } },
            guestUser: { select: { name: true } },
          },
        }),
      ]);

      if (recordings.length === 0 && files.length === 0) {
        return `Ve Studánce nic nového za posledních ${hours}h.`;
      }

      const lines: string[] = [];
      for (const r of recordings) {
        const who = r.guestUser?.name ?? "host";
        const dur = r.audioDurationSec ? `${Math.round(r.audioDurationSec / 60)} min` : "";
        lines.push(
          `• ${fmtDateTime(r.createdAt)} — ${who} v "${r.project.name}" (${r.type.toLowerCase()}${dur ? `, ${dur}` : ""})`,
        );
      }
      for (const f of files) {
        const who = f.guestUser?.name ?? "host";
        lines.push(
          `• ${fmtDateTime(f.uploadedAt)} — ${who} v "${f.project.name}": ${f.originalName}`,
        );
      }

      return `${lines.length} položek za posledních ${hours}h:\n${lines.join("\n")}`;
    },
  });

  return [getTasks, getEvents, getSchedule, getStudankaActivity];
}
