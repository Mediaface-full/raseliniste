import type { APIRoute } from "astro";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

const Body = z.object({
  vyruseni: z.string().nullable().optional(),
  vip: z.string().nullable().optional(),
  mojeUkoly: z.string().nullable().optional(),
  // Smart routing — NOVÉ 2026-05-10
  praceProjectName: z.string().max(80).nullable().optional(),
  peopleProjectName: z.string().max(80).nullable().optional(),
  tagToProject: z.record(
    z.string(),
    z.object({
      project: z.string().max(80),
      section: z.string().max(80).nullable(),
    }),
  ).optional(),
});

export const PATCH: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch {
    return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const integration = await prisma.userIntegration.findUnique({
    where: { userId_provider: { userId: session.uid, provider: "todoist" } },
  });
  if (!integration) {
    return Response.json({ error: "Nejdřív ulož token." }, { status: 400 });
  }

  // Merge — zachovat existující fieldy které nepřišly v body
  const existingConfig = ((integration.config as unknown) ?? {}) as Record<string, unknown>;
  const config: Record<string, unknown> = {
    ...existingConfig,
    ...(body.vyruseni !== undefined ? { vyruseni: body.vyruseni ?? undefined } : {}),
    ...(body.vip !== undefined ? { vip: body.vip ?? undefined } : {}),
    ...(body.mojeUkoly !== undefined ? { mojeUkoly: body.mojeUkoly ?? undefined } : {}),
    ...(body.praceProjectName !== undefined ? { praceProjectName: body.praceProjectName ?? undefined } : {}),
    ...(body.peopleProjectName !== undefined ? { peopleProjectName: body.peopleProjectName ?? undefined } : {}),
    ...(body.tagToProject !== undefined ? { tagToProject: body.tagToProject } : {}),
  };

  await prisma.userIntegration.update({
    where: { id: integration.id },
    data: { config },
  });

  return Response.json({ ok: true });
};
