import { prisma } from "./db";

/**
 * Petr 2026-05-27 #7: agregace notifikací pro `/notifikace` stránku +
 * counter v tile na `/start`.
 *
 * Zdroje (priority shora):
 *  1. Pošta — EmailMessage s EmailClassification actionType=action_required,
 *     urgency=high OR escalation=true, za posledních 48h
 *  2. Studánka — ProjectRecording z posledních 24h ve status=processed
 *     (nový obsah ke kontrole — Petr buď nahrál sám nebo host)
 *  3. VIP — CallLog wasVip=true za posledních 48h (zprávy od VIP)
 *
 * Vrací unified array pro UI — `time` = ISO, `type` = source, `href` = klikatelný
 * cíl, `meta` = type-specific data (summary, sender, …).
 */

export type NotificationItem =
  | {
      id: string;
      type: "studanka";
      time: string;
      href: string;
      title: string;
      summary: string | null;
      meta: {
        projectName: string;
        authorName: string;
        recordingType: string;
      };
    }
  | {
      id: string;
      type: "posta";
      time: string;
      href: string;
      title: string;
      summary: string | null;
      meta: {
        from: string;
        urgency: string;
        escalation: boolean;
        suggestedAction: string | null;
      };
    }
  | {
      id: string;
      type: "vip";
      time: string;
      href: string;
      title: string;
      summary: string | null;
      meta: {
        contactName: string;
        isUrgent: boolean;
      };
    };

/**
 * Petr 2026-05-27: blacklist match — vrátí true pokud email má být IGNOROVÁN.
 * Aplikuje se na fromAddress + fromName (case insensitive).
 *
 * matchType:
 *  - contains: substring v from address NEBO from name
 *  - domain:   fromAddress končí "@<pattern>"
 *  - exact:    fromAddress === pattern
 */
export function emailMatchesIgnoreRule(
  fromAddress: string | null,
  fromName: string | null,
  rule: { pattern: string; matchType: string },
): boolean {
  const addr = (fromAddress ?? "").toLowerCase();
  const name = (fromName ?? "").toLowerCase();
  const p = rule.pattern.toLowerCase();
  if (rule.matchType === "domain") return addr.endsWith(`@${p}`);
  if (rule.matchType === "exact") return addr === p;
  return addr.includes(p) || name.includes(p);
}

export async function loadNotifications(userId: string): Promise<NotificationItem[]> {
  const now = new Date();
  const ago24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const ago48h = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  // Paralelně 3 zdroje + ignore rules
  const [recordings, rawEmails, vipLogs, ignoreRules] = await Promise.all([
    // Studánka — nové ProjectRecording (status=processed za 24h, pouze projects ownerova)
    prisma.projectRecording.findMany({
      where: {
        createdAt: { gte: ago24h },
        status: "processed",
        project: { userId },
      },
      select: {
        id: true,
        createdAt: true,
        projectId: true,
        authorName: true,
        type: true,
        analysis: true,
        transcript: true,
        project: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),

    // Pošta — action_required + (urgency=high OR escalation=true), za 48h
    prisma.emailMessage.findMany({
      where: {
        userId,
        receivedAt: { gte: ago48h },
        classification: {
          actionType: "action_required",
          OR: [
            { urgency: "high" },
            { escalation: true },
          ],
        },
      },
      select: {
        id: true,
        receivedAt: true,
        subject: true,
        fromName: true,
        fromAddress: true,
        snippet: true,
        classification: {
          select: {
            urgency: true,
            escalation: true,
            suggestedAction: true,
          },
        },
      },
      orderBy: { receivedAt: "desc" },
      take: 20,
    }),

    // VIP — CallLog za 48h, wasVip=true
    prisma.callLog.findMany({
      where: {
        userId,
        createdAt: { gte: ago48h },
        wasVip: true,
      },
      select: {
        id: true,
        createdAt: true,
        message: true,
        isUrgent: true,
        contact: { select: { displayName: true, firstName: true } },
        phoneNumber: true,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),

    // Petr 2026-05-27: blacklist rules pro filter emailů
    prisma.postaIgnoreRule.findMany({
      where: { userId, enabled: true },
      select: { pattern: true, matchType: true },
    }),
  ]);

  // Aplikuj ignore rules na emaily před tím než půjdou do items
  const emails = ignoreRules.length === 0
    ? rawEmails
    : rawEmails.filter((e) => !ignoreRules.some((r) => emailMatchesIgnoreRule(e.fromAddress, e.fromName, r)));

  const items: NotificationItem[] = [];

  for (const r of recordings) {
    const analysis = r.analysis as { summary?: string } | null;
    items.push({
      id: r.id,
      type: "studanka",
      time: r.createdAt.toISOString(),
      href: `/studna/${r.projectId}#rec-${r.id}`,
      title: `Studánka: nová nahrávka v „${r.project.name}"`,
      summary: analysis?.summary?.slice(0, 280) ?? r.transcript.slice(0, 200),
      meta: {
        projectName: r.project.name,
        authorName: r.authorName,
        recordingType: r.type,
      },
    });
  }

  for (const e of emails) {
    items.push({
      id: e.id,
      type: "posta",
      time: e.receivedAt.toISOString(),
      href: `/posta/${e.id}`,
      title: e.subject ?? "(bez předmětu)",
      summary: e.snippet?.slice(0, 280) ?? null,
      meta: {
        from: e.fromName?.trim() || e.fromAddress || "(neznámý)",
        urgency: e.classification?.urgency ?? "high",
        escalation: e.classification?.escalation ?? false,
        suggestedAction: e.classification?.suggestedAction ?? null,
      },
    });
  }

  for (const v of vipLogs) {
    const name = v.contact?.displayName?.trim() || v.contact?.firstName || v.phoneNumber;
    items.push({
      id: v.id,
      type: "vip",
      time: v.createdAt.toISOString(),
      href: `/call-log#log-${v.id}`,
      title: `VIP zpráva — ${name}`,
      summary: v.message.slice(0, 280),
      meta: {
        contactName: name,
        isUrgent: v.isUrgent,
      },
    });
  }

  // Sortuj všechny dohromady DESC podle času
  items.sort((a, b) => b.time.localeCompare(a.time));

  return items;
}

/**
 * Lehčí počet — pro tile badge na /start. Bez načítání plných dat.
 */
export async function countNotifications(userId: string): Promise<number> {
  const now = new Date();
  const ago24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const ago48h = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  // Petr 2026-05-27: count musí taky respektovat blacklist, jinak badge
  // tile na /start ukazuje vyšší číslo než /notifikace list.
  // Pro count fetchneme email metadata (fromAddress/Name) místo .count(),
  // jinak nedokážeme filter aplikovat.
  const [recordings, rawEmails, vipLogs, ignoreRules] = await Promise.all([
    prisma.projectRecording.count({
      where: {
        createdAt: { gte: ago24h },
        status: "processed",
        project: { userId },
      },
    }),
    prisma.emailMessage.findMany({
      where: {
        userId,
        receivedAt: { gte: ago48h },
        classification: {
          actionType: "action_required",
          OR: [{ urgency: "high" }, { escalation: true }],
        },
      },
      select: { fromAddress: true, fromName: true },
    }),
    prisma.callLog.count({
      where: {
        userId,
        createdAt: { gte: ago48h },
        wasVip: true,
      },
    }),
    prisma.postaIgnoreRule.findMany({
      where: { userId, enabled: true },
      select: { pattern: true, matchType: true },
    }),
  ]);

  const emails = ignoreRules.length === 0
    ? rawEmails.length
    : rawEmails.filter((e) => !ignoreRules.some((r) => emailMatchesIgnoreRule(e.fromAddress, e.fromName, r))).length;

  return recordings + emails + vipLogs;
}
