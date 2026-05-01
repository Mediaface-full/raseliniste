import type { APIRoute } from "astro";
import { z } from "zod";
import { readSession } from "@/lib/session";
import { navrhniDalsiVarianty } from "@/lib/bwmys-ai";

export const prerender = false;

const Body = z.object({
  otazka: z.string().min(3).max(500),
  soucasneVarianty: z.array(z.string().min(1)).min(1).max(10),
});

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

  try {
    const varianty = await navrhniDalsiVarianty(body.otazka, body.soucasneVarianty);
    return Response.json({ varianty });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
};
