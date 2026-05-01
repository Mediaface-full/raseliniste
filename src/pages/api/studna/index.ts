import type { APIRoute } from "astro";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";

export const prerender = false;

const Body = z.object({
  name: z.string().min(1).max(120),
  homeTitle: z.string().max(20).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  extractionPrompt: z.string().max(8000).nullable().optional(),
  includeInDigest: z.boolean().optional(),
  isPrivate: z.boolean().optional(),
});

export const GET: APIRoute = async ({ cookies, url }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  // Filter dle modulu:
  //   ?private=1 → jen Prskavka projekty (osobní)
  //   bez parametru / =0 → jen Studánka (sdílené s klienty)
  const isPrivate = url.searchParams.get("private") === "1";

  const projects = await prisma.projectBox.findMany({
    where: { userId: session.uid, archivedAt: null, isPrivate },
    include: {
      _count: {
        select: { recordings: true, invitations: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return Response.json({ projects });
};

export const POST: APIRoute = async ({ request, cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await request.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : "INVALID_INPUT";
    return Response.json({ error: msg }, { status: 400 });
  }

  const project = await prisma.projectBox.create({
    data: {
      userId: session.uid,
      name: body.name,
      homeTitle: body.homeTitle?.slice(0, 20) ?? null,
      description: body.description ?? null,
      extractionPrompt: body.extractionPrompt ?? null,
      includeInDigest: body.includeInDigest ?? true,
      isPrivate: body.isPrivate ?? false,
    },
  });

  return Response.json({ project });
};
