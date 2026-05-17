import type { APIRoute } from "astro";
import { readSession } from "@/lib/session";
import { getSchedulingConfig, timeOnDate } from "@/lib/rules-config";
import { listAvailableSlots } from "@/lib/rules";

export const prerender = false;

/**
 * GET /api/calendar/diagnose
 *
 * Petr 2026-05-17: diagnostika proč booking nabízí sloty mimo onlineHours.
 * Vrací:
 *   - server timezone (TZ env + Date.toString)
 *   - current scheduling config (z DB nebo defaults)
 *   - generované sloty pro online v nejbližších 7 dnech (CLIENT mode, 60 min)
 *   - sample timeOnDate() output — zda setHours interpretuje v lokálním nebo UTC
 */
export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const cfg = await getSchedulingConfig();

  // Sample: jak server interpretuje "17:00" na dnešní datum
  const today = new Date();
  const seventeenLocal = timeOnDate(today, "17:00");
  const tz = process.env.TZ ?? "(not set)";

  // Vygeneruj sloty pro online v CLIENT modu na 7 dnů
  const slots = await listAvailableSlots({
    meetingTypes: ["MEETING_ONLINE"],
    bookingMode: "CLIENT",
    slotDurationMinutes: 60,
    horizonDays: 14,
  });

  return Response.json({
    server: {
      TZ_env: tz,
      now_local: today.toString(),
      now_iso: today.toISOString(),
      sample_setHours_17: {
        local_string: seventeenLocal.toString(),
        iso_utc: seventeenLocal.toISOString(),
        hour_local: seventeenLocal.getHours(),
        hour_utc: seventeenLocal.getUTCHours(),
      },
    },
    config: {
      onlineDays: cfg.onlineDays,
      onlineHours: cfg.onlineHours,
      lunchBreak: cfg.lunchBreak,
      endOfDay: cfg.endOfDay,
      minLeadTimeClientHours: cfg.minLeadTimeClientHours,
      bufferOnlineBetweenMinutes: cfg.bufferOnlineBetweenMinutes,
      maxBookingHorizonDays: cfg.maxBookingHorizonDays,
    },
    slotsGenerated: slots.slice(0, 20).map((s) => ({
      day: new Date(s.startsAt).toLocaleDateString("cs-CZ", { weekday: "short", day: "numeric", month: "short" }),
      startsAt_local: new Date(s.startsAt).toLocaleString("cs-CZ", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "numeric" }),
      startsAt_iso: s.startsAt.toISOString(),
      endsAt_iso: s.endsAt.toISOString(),
      type: s.type,
    })),
    totalSlots: slots.length,
  });
};
