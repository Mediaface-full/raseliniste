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
    description: "Todoist obousměrný sync (status + nové úkoly)",
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
    schedule: { type: "every", minutes: 15 },
    description: "Pošta — Gmail incremental sync (fáze 1: full pull newer_than:1d, max 100 mailů)",
  },
  {
    name: "posta-classify",
    endpoint: "/api/cron/posta-classify",
    schedule: { type: "every", minutes: 15 },
    description: "Pošta — klasifikace unclassified mailů (fáze 2: max 50/iteraci, Gemini Flash)",
  },
  {
    name: "cleanup-sms",
    endpoint: "/api/cron/cleanup-sms",
    schedule: { type: "daily", hour: 3, minute: 30 },
    description: "GoSMS — mazání SmsMessage starších 90 dní (mimo isPinned)",
  },
];
