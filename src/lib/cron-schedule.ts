/**
 * Centralizovaný rozvrh všech interních cronů.
 *
 * Jeden externí DSM Task Scheduler entry volá `/api/cron/scheduler` každých
 * 5 min; dispatcher tenhle seznam projde, pro každý job zkontroluje match
 * (typ schedule + idempotence přes CronRun.lastSuccessAt) a spustí ho přes
 * fetch na localhost.
 *
 * Existující cron endpointy (`/api/cron/<name>`) jsou ZACHOVANÉ — slouží
 * jako fallback pro manuální spuštění z DSM nebo z Bash. Logika tam zůstává
 * beze změny, dispatcher je jen volá.
 *
 * Schedule typy:
 *  - every:5/15/30/60min  — periodicky, gap kontrolovaný proti lastSuccessAt
 *  - daily HH:MM          — denně v daný čas (±2.5 min tolerance), max 1× /den
 *  - monthly-last-day HH:MM — poslední den měsíce, max 1× /měsíc
 */

export type Schedule =
  | { type: "every"; minutes: 5 | 15 | 30 | 60 }
  | { type: "daily"; hour: number; minute: number }
  | { type: "monthly-last-day"; hour: number; minute: number };

export interface CronJobDef {
  /** Logický název — používá se jako `CronRun.jobName`. */
  name: string;
  /** HTTP cesta endpointu (relativní). Dispatcher ji volá přes localhost. */
  endpoint: string;
  /** Volitelný query string (bez vedoucího `?`). */
  query?: string;
  schedule: Schedule;
  /**
   * Pokud true, dispatcher na response endpointu nečeká (Promise.race s timeoutem).
   * Vhodné pro long-running joby (briefingy 60-120 s) — scheduler pak rychle
   * dokončí a další minutu může běžet další iterace.
   */
  fireAndForget?: boolean;
  /** Pokud false, dispatcher job přeskočí (rychlý disable bez mazání). */
  enabled?: boolean;
  /** Krátký popis pro logging / docs. */
  description?: string;
}

export const CRON_JOBS: CronJobDef[] = [
  {
    name: "sync-calendars",
    endpoint: "/api/cron/sync-calendars",
    schedule: { type: "every", minutes: 5 },
    description: "Pull Google Calendar událostí",
  },
  {
    name: "sync-contacts",
    endpoint: "/api/cron/sync-contacts",
    schedule: { type: "daily", hour: 4, minute: 0 },
    description: "Pull Google Contacts (People API)",
  },
  {
    name: "sync-contacts-icloud",
    endpoint: "/api/cron/sync-contacts-icloud",
    schedule: { type: "every", minutes: 30 },
    description: "Pull iCloud Contacts (CardDAV) + auto-merge duplicit",
  },
  {
    name: "nightly-briefing",
    endpoint: "/api/cron/nightly-briefing",
    schedule: { type: "daily", hour: 22, minute: 0 },
    fireAndForget: true,
    description: "Noční briefing → Todoist",
  },
  {
    name: "retry-stuck-recordings",
    endpoint: "/api/cron/retry-stuck-recordings",
    schedule: { type: "every", minutes: 15 },
    description: "Studna — retry zaseknutých nahrávek",
  },
  {
    name: "cleanup-audio",
    endpoint: "/api/cron/cleanup-audio",
    schedule: { type: "daily", hour: 3, minute: 0 },
    description: "Studna — mazání starých audio souborů",
  },
  {
    name: "cleanup-spiz",
    endpoint: "/api/cron/cleanup-spiz",
    schedule: { type: "daily", hour: 3, minute: 10 },
    description: "Spíž — mazání expirovaných sdílených souborů (>14 dní)",
  },
  {
    name: "daily-projects-digest",
    endpoint: "/api/cron/daily-projects-digest",
    schedule: { type: "daily", hour: 7, minute: 0 },
    description: "Studna — denní digest projektů",
  },
  {
    name: "monthly-health-report",
    endpoint: "/api/cron/monthly-health-report",
    schedule: { type: "monthly-last-day", hour: 23, minute: 0 },
    fireAndForget: true,
    description: "Měsíční zdravotní report",
  },
  {
    name: "cleanup-expired-invites",
    endpoint: "/api/cron/cleanup-expired-invites",
    schedule: { type: "daily", hour: 1, minute: 0 },
    description: "Booking — mazání expirovaných pozvánek",
  },
  {
    name: "cleanup-task-audio-batches",
    endpoint: "/api/cron/cleanup-task-audio-batches",
    schedule: { type: "daily", hour: 2, minute: 30 },
    description: "Úkoly — mazání starých audio batchů",
  },
  {
    name: "retry-stuck-task-batches",
    endpoint: "/api/cron/retry-stuck-task-batches",
    schedule: { type: "every", minutes: 5 },
    description: "Úkoly — retry zaseknutých batchů",
  },
  {
    name: "cleanup-journal-audio",
    endpoint: "/api/cron/cleanup-journal-audio",
    schedule: { type: "daily", hour: 3, minute: 15 },
    description: "Deník — mazání starých audio souborů",
  },
  {
    name: "anniversary-reminders",
    endpoint: "/api/cron/anniversary-reminders",
    schedule: { type: "daily", hour: 7, minute: 5 },
    description: "Výročí + narozeniny notifikace",
  },
  {
    name: "zijes-lunch",
    endpoint: "/api/cron/zijes-reminder",
    query: "type=lunch",
    schedule: { type: "daily", hour: 13, minute: 0 },
    description: "ŽIJEŠ? polední check-in",
  },
  {
    name: "zijes-evening",
    endpoint: "/api/cron/zijes-reminder",
    query: "type=evening",
    schedule: { type: "daily", hour: 18, minute: 0 },
    description: "ŽIJEŠ? večerní check-in",
  },
  {
    name: "bwmys-tick",
    endpoint: "/api/cron/bwmys-tick",
    schedule: { type: "daily", hour: 7, minute: 10 },
    description: "B&W Myš — denní údržba rozhodovacího systému",
  },
  {
    name: "todoist-sync",
    endpoint: "/api/cron/todoist-sync",
    schedule: { type: "every", minutes: 5 },
    fireAndForget: true,
    description: "Todoist obousměrný sync (status + nové úkoly). 2026-05-18 Petr: fireAndForget=true protože sync s 23+ projekty + tasks překračuje 90s dispatcher timeout (errorCount 75%); běží na pozadí bez čekání.",
  },
  {
    name: "poll-sms-status",
    endpoint: "/api/cron/poll-sms-status",
    schedule: { type: "every", minutes: 30 },
    description: "GoSMS — fallback polling stavu odeslaných SMS (kdyby webhook spadl)",
  },
  {
    name: "posta-sync",
    endpoint: "/api/cron/posta-sync",
    schedule: { type: "every", minutes: 30 },
    description: "Pošta — Gmail polling sync (fáze 5: ZÁCHRANNÝ pattern při ztrátě push notifikace; interval 30 min od fáze 5, drive je Pub/Sub push)",
  },
  {
    name: "posta-classify",
    endpoint: "/api/cron/posta-classify",
    schedule: { type: "every", minutes: 15 },
    description: "Pošta — klasifikace unclassified mailů (fáze 2: max 50/iteraci, Gemini Flash)",
  },
  {
    name: "posta-digest",
    endpoint: "/api/cron/posta-digest",
    schedule: { type: "daily", hour: 7, minute: 0 },
    description: "Pošta — denní digest snapshot (fáze 3: top akce + eskalace + LLM summary)",
  },
  {
    name: "posta-embed",
    endpoint: "/api/cron/posta-embed",
    schedule: { type: "every", minutes: 5 },
    description: "Pošta — RAG embedding pipeline (fáze 4: chunking + Gemini embed, max 50/iteraci, DLQ při selhání)",
  },
  {
    name: "posta-cleanup",
    endpoint: "/api/cron/posta-cleanup",
    schedule: { type: "daily", hour: 3, minute: 0 },
    description: "Pošta — 96denní retention (fáze 5: nuluje bodyText/Html/attachments/rawHeaders, zachová metadata + chunks pro search)",
  },
  {
    name: "posta-watch-renew",
    endpoint: "/api/cron/posta-watch-renew",
    schedule: { type: "daily", hour: 4, minute: 0 },
    description: "Pošta — Gmail watch renewal (fáze 5: prodlouží watch expirující v < 48h; Gmail max lifetime 7d)",
  },
  {
    name: "posta-backfill",
    endpoint: "/api/cron/posta-backfill",
    schedule: { type: "every", minutes: 15 },
    description: "Pošta — multi-tick zpětný import historie (2026-05-13: pro usery s gmailBackfillStartedAt && !Completed, jedna page 500 mailů per tick, metadata-only)",
  },
  {
    name: "posta-fill-bodies",
    endpoint: "/api/cron/posta-fill-bodies",
    schedule: { type: "every", minutes: 10 },
    description: "Pošta — doplnění plných body pro metadata-only maily po backfill cleanup (2026-05-13: max 100/tick, Gmail messages.get?format=full)",
  },
  {
    name: "posta-commitment-detect",
    endpoint: "/api/cron/posta-commitment-detect",
    schedule: { type: "every", minutes: 15 },
    description: "Pošta — detector vyšumělých závazků (fáze 6: LLM scan outbound mailů, dedup soft-link, confidence routing >=0.85 auto)",
  },
  {
    name: "posta-commitment-todoist-sync",
    endpoint: "/api/cron/posta-commitment-todoist-sync",
    schedule: { type: "every", minutes: 5 },
    description: "Pošta — commitment 1-way Todoist sync (fáze 6: create/close/delete/label, rate limit 30/min)",
  },
  {
    name: "posta-commitment-stale",
    endpoint: "/api/cron/posta-commitment-stale",
    schedule: { type: "daily", hour: 3, minute: 0 },
    description: "Pošta — stale marker pro commitmenty bez akce 30+ dnů (fáze 6: status active → stale)",
  },
  {
    name: "cleanup-sms",
    endpoint: "/api/cron/cleanup-sms",
    schedule: { type: "daily", hour: 3, minute: 30 },
    description: "GoSMS — mazání SmsMessage starších 90 dní (mimo isPinned)",
  },
  {
    name: "backup",
    endpoint: "/api/cron/backup",
    schedule: { type: "daily", hour: 2, minute: 0 },
    fireAndForget: true,
    description: "Záloha: pg_dump + tar.gz uploads → rsync na druhý NAS přes Tailscale. Retention 30 dní.",
  },
];
