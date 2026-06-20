/**
 * /api/calendar/settings — GET + PUT pro SchedulingConfig.
 *
 * Public API:
 *   - GET  → vrátí aktuální config (lazy-seed default při prvním načtení)
 *   - PUT  → upsert config + invalidace cache
 *
 * Auth: vyžaduje session (jediný admin user Rašeliniště).
 */

import type { APIRoute } from "astro";
import { z } from "zod";
import { readSession } from "@/lib/session";
import { getSchedulingConfig, saveSchedulingConfig, type SchedulingConfig, type DayOfWeek } from "@/lib/rules-config";

export const prerender = false;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const time = () => z.string().regex(TIME_RE, "HH:MM formát");

const DayInt = z.number().int().min(0).max(6);

const Body = z.object({
  pragueDays: z.array(DayInt).max(7),
  pragueHours: z.object({ start: time(), end: time() }),
  homeDays: z.array(DayInt).max(7),
  homeHours: z.object({ start: time(), end: time() }),
  onlineDays: z.array(DayInt).max(7),
  onlineHours: z.object({ start: time(), end: time() }),
  // Petr 2026-06-19: pracovní oběd v Praze. Backward-compat: optional + default
  // pro existující klienty kteří ještě nepošlou tyhle fieldy.
  lunchBookingDays: z.array(DayInt).max(7).optional().default([]),
  lunchBookingHours: z.object({ start: time(), end: time() }).optional().default({ start: "11:00", end: "13:30" }),
  lunchBreak: z.object({ start: time(), end: time() }),
  endOfDay: time(),
  bufferPragueMinutes: z.number().int().min(0).max(480),
  bufferOnlineBetweenMinutes: z.number().int().min(0).max(240),
  minLeadTimeClientHours: z.number().int().min(0).max(720),
  minLeadTimeFriendHours: z.number().int().min(0).max(720),
  maxBookingHorizonDays: z.number().int().min(1).max(180),
  maxPragueWarning: z.number().int().min(0).max(20),
  maxInPersonWarning: z.number().int().min(0).max(20),
  maxInPersonError: z.number().int().min(0).max(20),
  maxOnlineWarning: z.number().int().min(0).max(20),
  weightedLoadWarning: z.number().min(0).max(20),
  weightedLoadError: z.number().min(0).max(20),
});

export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const config = await getSchedulingConfig();
  return Response.json({ config });
};

export const PUT: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : String(e);
    return Response.json({ error: msg }, { status: 400 });
  }

  // Logická validace
  if (parsed.pragueHours.start >= parsed.pragueHours.end) {
    return Response.json({ error: "Praha: konec hodin musí být po začátku." }, { status: 400 });
  }
  if (parsed.homeHours.start >= parsed.homeHours.end) {
    return Response.json({ error: "Doma: konec hodin musí být po začátku." }, { status: 400 });
  }
  if (parsed.onlineHours.start >= parsed.onlineHours.end) {
    return Response.json({ error: "Online: konec hodin musí být po začátku." }, { status: 400 });
  }
  if (parsed.maxInPersonError <= parsed.maxInPersonWarning) {
    return Response.json({ error: "Prezenční: error threshold musí být vyšší než warning." }, { status: 400 });
  }
  if (parsed.weightedLoadError <= parsed.weightedLoadWarning) {
    return Response.json({ error: "Weighted load: error musí být vyšší než warning." }, { status: 400 });
  }

  const config: SchedulingConfig = {
    pragueDays: parsed.pragueDays as DayOfWeek[],
    pragueHours: parsed.pragueHours,
    homeDays: parsed.homeDays as DayOfWeek[],
    homeHours: parsed.homeHours,
    onlineDays: parsed.onlineDays as DayOfWeek[],
    onlineHours: parsed.onlineHours,
    lunchBookingDays: parsed.lunchBookingDays as DayOfWeek[],
    lunchBookingHours: parsed.lunchBookingHours,
    lunchBreak: parsed.lunchBreak,
    endOfDay: parsed.endOfDay,
    bufferPragueMinutes: parsed.bufferPragueMinutes,
    bufferOnlineBetweenMinutes: parsed.bufferOnlineBetweenMinutes,
    minLeadTimeClientHours: parsed.minLeadTimeClientHours,
    minLeadTimeFriendHours: parsed.minLeadTimeFriendHours,
    maxBookingHorizonDays: parsed.maxBookingHorizonDays,
    maxPragueWarning: parsed.maxPragueWarning,
    maxInPersonWarning: parsed.maxInPersonWarning,
    maxInPersonError: parsed.maxInPersonError,
    maxOnlineWarning: parsed.maxOnlineWarning,
    weightedLoadWarning: parsed.weightedLoadWarning,
    weightedLoadError: parsed.weightedLoadError,
  };

  await saveSchedulingConfig(session.uid, config);
  return Response.json({ ok: true, config });
};
