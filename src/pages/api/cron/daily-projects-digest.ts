import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { sendMail } from "@/lib/mailer";

export const prerender = false;

/**
 * Denní souhrn aktivit ve Studně.
 *
 * Synology Task Scheduler:
 *   - Každý den 7:00 ráno
 *   - curl -X POST https://www.raseliniste.cz/api/cron/daily-projects-digest
 *          -H "x-cron-key: <CRON_SECRET>"
 *
 * Logika:
 *   1. Vezme všechny záznamy z posledních 24 h (now-24h → now)
 *   2. Sgrupuje podle projektu (jen těch, co mají includeInDigest=true)
 *   3. Pokud nic nepřibylo → e-mail se neposílá
 *   4. Jinak: pošle souhrn na User.notificationEmail / env.NOTIFICATION_EMAIL
 *
 * Předmět: "Studánka — N nových nahrávek (Jméno, Jméno)"
 * Tělo: per-projekt blok, každý záznam → autor + čas + 200 znaků z transkriptu.
 */

interface RecordingForDigest {
  authorName: string;
  isOwner: boolean;
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  analysis: any;
  transcript: string;
  audioDurationSec: number | null;
  createdAt: Date;
}

function last24hBounds(): { from: Date; to: Date } {
  const now = new Date();
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return { from, to: now };
}

export const POST: APIRoute = async ({ request, url }) => {
  const secret = env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_NOT_CONFIGURED" }, { status: 503 });
  if (request.headers.get("x-cron-key") !== secret) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  // Volitelně override datumu přes ?date=YYYY-MM-DD (pro testování — vezme celý ten den)
  const qDate = url.searchParams.get("date");
  let from: Date, to: Date;
  if (qDate) {
    from = new Date(`${qDate}T00:00:00`);
    to = new Date(`${qDate}T23:59:59`);
  } else {
    ({ from, to } = last24hBounds());
  }

  const users = await prisma.user.findMany({
    select: { id: true, username: true, notificationEmail: true },
  });

  const summaries: Array<{ user: string; sent: boolean; reason?: string }> = [];

  for (const user of users) {
    const projects = await prisma.projectBox.findMany({
      where: {
        userId: user.id,
        archivedAt: null,
        includeInDigest: true,
      },
      select: { id: true, name: true },
    });
    if (projects.length === 0) {
      summaries.push({ user: user.username, sent: false, reason: "no_projects" });
      continue;
    }

    const projectIds = projects.map((p) => p.id);
    const recordings = await prisma.projectRecording.findMany({
      where: {
        projectId: { in: projectIds },
        createdAt: { gte: from, lte: to },
        status: "processed",
      },
      select: {
        projectId: true,
        authorName: true,
        isOwner: true,
        type: true,
        analysis: true,
        transcript: true,
        audioDurationSec: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    if (recordings.length === 0) {
      summaries.push({ user: user.username, sent: false, reason: "no_activity_today" });
      continue;
    }

    // Sgrupuj per projekt
    const byProject = new Map<string, RecordingForDigest[]>();
    for (const r of recordings) {
      const arr = byProject.get(r.projectId) ?? [];
      arr.push(r);
      byProject.set(r.projectId, arr);
    }

    const to_email = user.notificationEmail ?? env.NOTIFICATION_EMAIL;
    if (!to_email) {
      summaries.push({ user: user.username, sent: false, reason: "no_email" });
      continue;
    }

    const html = renderDigestHtml(projects, byProject);
    // Sgrupuj autory přes všechny projekty (max 4 jména v subjectu, jinak "+N")
    const allAuthors = new Set<string>();
    for (const r of recordings) allAuthors.add(r.authorName);
    const authorList = Array.from(allAuthors);
    const authorSubj = authorList.length <= 4
      ? authorList.join(", ")
      : `${authorList.slice(0, 4).join(", ")} +${authorList.length - 4}`;
    const subject = `Studánka — ${recordings.length} ${plural(recordings.length, "nová nahrávka", "nové nahrávky", "nových nahrávek")} (${authorSubj})`;

    const result = await sendMail({
      to: to_email,
      subject,
      html,
      text: `${recordings.length} nových záznamů za posledních 24 h. Otevři https://www.raseliniste.cz/studna/aktivita`,
    });
    summaries.push({ user: user.username, sent: result.ok, reason: result.ok ? undefined : (result as { error: string }).error });
  }

  return Response.json({ ok: true, processed: summaries });
};

function snippet(text: string, len = 200): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= len) return t;
  return t.slice(0, len).replace(/\s+\S*$/, "") + "…";
}

function fmtDuration(sec: number | null): string {
  if (!sec || sec <= 0) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")} min` : `${s} s`;
}

function fmtTime(d: Date): string {
  return d.toLocaleString("cs-CZ", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "numeric" });
}

function renderDigestHtml(
  projects: { id: string; name: string }[],
  byProject: Map<string, RecordingForDigest[]>,
): string {
  const projectMap = new Map(projects.map((p) => [p.id, p.name]));
  const rows: string[] = [];

  for (const [projectId, recs] of byProject) {
    const projectName = projectMap.get(projectId) ?? "Neznámý projekt";

    const items: string[] = [];
    for (const r of recs) {
      const meta = [fmtTime(r.createdAt), r.type === "BRIEF" ? "BRIEF" : null, fmtDuration(r.audioDurationSec)]
        .filter(Boolean)
        .join(" · ");
      const preview = snippet(r.transcript, 200);
      items.push(`
        <div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.06);">
          <div style="font-size:14px;color:#fff;margin-bottom:2px;">
            <strong>${escapeHtml(r.authorName)}</strong>
            <span style="color:#9a8f82;font-family:ui-monospace,monospace;font-size:12px;margin-left:6px;">${escapeHtml(meta)}</span>
          </div>
          ${preview ? `<div style="font-size:13px;color:#c9c2b6;line-height:1.55;font-style:italic;">„${escapeHtml(preview)}"</div>` : `<div style="font-size:12px;color:#6b665f;">(žádný přepis)</div>`}
        </div>
      `);
    }

    rows.push(`
      <div style="border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:18px;margin-bottom:14px;background:#241f1b;">
        <div style="font-family:Georgia,serif;font-size:18px;color:#fff;margin-bottom:4px;">${escapeHtml(projectName)}</div>
        <div style="font-size:12px;color:#9a8f82;margin-bottom:14px;font-family:ui-monospace,monospace;">
          ${recs.length} ${plural(recs.length, "záznam", "záznamy", "záznamů")}
        </div>
        ${items.join("")}
      </div>
    `);
  }

  return `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#1a1714;color:#e8e3d9;font-family:-apple-system,BlinkMacSystemFont,'Geist','Segoe UI',sans-serif;line-height:1.55;">
  <div style="max-width:640px;margin:0 auto;padding:24px 20px;">
    <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#b8763c;font-family:ui-monospace,monospace;margin-bottom:6px;">
      Rašeliniště · Studánka
    </div>
    <h1 style="font-family:Georgia,serif;font-size:24px;margin:0 0 18px;color:#fff;letter-spacing:-0.01em;">
      Co se ve Studně dělo za posledních 24 h
    </h1>
    ${rows.join("")}
    <div style="font-size:11px;color:#6b665f;font-family:ui-monospace,monospace;margin-top:18px;">
      Plný výpis: <a href="https://www.raseliniste.cz/studna/aktivita" style="color:#b8763c;">/studna/aktivita</a>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n >= 2 && n <= 4) return few;
  return many;
}
