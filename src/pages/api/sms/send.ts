import type { APIRoute } from "astro";
import { z } from "zod";
import { readSession } from "@/lib/session";
import { sendUserSms } from "@/lib/sms-send";

export const prerender = false;

const Body = z.object({
  to: z.union([z.string().min(3), z.array(z.string().min(3)).min(1).max(100)]),
  message: z.string().min(1).max(1000),
  channel: z.number().int().positive().optional(),
  scheduledFor: z.string().datetime().optional(),
  linkedEntity: z
    .object({
      type: z.enum(["task", "contact", "recording", "birthday", "booking", "ad-hoc"]),
      id: z.string().optional(),
      label: z.string().optional(),
    })
    .optional(),
  pinned: z.boolean().optional(),
});

/**
 * POST — odeslat SMS. Volá interní helper sendUserSms.
 * Vrací { ok, smsMessageId, gosmsMessageId, invalidRecipients } nebo { ok: false, error }.
 */
export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (err) {
    return Response.json(
      { error: "INVALID_INPUT", detail: err instanceof Error ? err.message : "" },
      { status: 400 },
    );
  }

  const result = await sendUserSms(session.uid, body);

  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.error, smsMessageId: result.smsMessageId },
      { status: 500 },
    );
  }

  return Response.json(result);
};
