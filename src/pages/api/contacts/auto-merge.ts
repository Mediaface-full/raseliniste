/**
 * POST /api/contacts/auto-merge
 *
 * Petr 2026-05-15: po 3 syncech má 3x stejný kontakt. Tento endpoint
 * automaticky sloučí duplicity podle phoneKey (posledních 9 číslic
 * jakéhokoli telefonu) NEBO podle čistého jména (firstName+lastName,
 * case-ins).
 *
 * Bezpečnost (preference primárka):
 *   1. Kontakt s isVip / clientTag / aliases (overlay flags) → vyhrává
 *   2. Kontakt s icloudUid → druhá preference
 *   3. Nejstarší createdAt → třetí preference
 *
 * Merge logika: stejná jako mergeContacts v contacts-duplicates.ts —
 * skalární doplnění, phones/emails/groups union, re-link vazeb,
 * auto-backup před delete.
 */

import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { mergeContacts } from "@/lib/contacts-duplicates";

export const prerender = false;

function phoneKey(num: string): string {
  return num.replace(/\D/g, "").slice(-9);
}

function nameKey(c: { firstName: string | null; lastName: string | null; displayName: string }): string {
  const parts = [
    (c.firstName ?? "").trim().toLowerCase(),
    (c.lastName ?? "").trim().toLowerCase(),
  ].filter(Boolean);
  if (parts.length === 0) {
    const d = c.displayName.trim().toLowerCase();
    if (!d || d.startsWith("&#") || d === "(bez jména)") return "";
    return d;
  }
  return parts.sort().join(" ");
}

function preferencePriority(c: { isVip: boolean; isTeam: boolean; clientTag: string | null; aliases: string[]; callLogToken: string | null; icloudUid: string | null; createdAt: Date }): number {
  let score = 0;
  if (c.isVip) score += 100;
  if (c.callLogToken) score += 50;
  if (c.clientTag) score += 30;
  if (c.aliases.length > 0) score += 20;
  if (c.isTeam) score += 15;
  if (c.icloudUid) score += 10;
  return score;
}

export const POST: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const contacts = await prisma.contact.findMany({
    where: { userId: session.uid },
    include: { phones: true, emails: true },
  });

  // Union-find clustering
  const parent = contacts.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const byPhone = new Map<string, number[]>();
  const byEmail = new Map<string, number[]>();
  const byName = new Map<string, number[]>();

  contacts.forEach((c, i) => {
    const nk = nameKey(c);
    if (nk) (byName.get(nk) ?? byName.set(nk, []).get(nk)!).push(i);
    for (const p of c.phones) {
      const k = phoneKey(p.number);
      if (k && k.length >= 6) (byPhone.get(k) ?? byPhone.set(k, []).get(k)!).push(i);
    }
    for (const e of c.emails) {
      const ek = e.email.toLowerCase().trim();
      if (ek) (byEmail.get(ek) ?? byEmail.set(ek, []).get(ek)!).push(i);
    }
  });

  for (const idxs of [...byPhone.values(), ...byEmail.values(), ...byName.values()]) {
    if (idxs.length < 2) continue;
    for (let i = 1; i < idxs.length; i++) union(idxs[0], idxs[i]);
  }

  // Group
  const clusters = new Map<number, number[]>();
  for (let i = 0; i < contacts.length; i++) {
    const r = find(i);
    (clusters.get(r) ?? clusters.set(r, []).get(r)!).push(i);
  }

  let merged = 0;
  let mergedClusters = 0;
  let errors = 0;

  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    // Vyber primárku podle priority
    const sorted = members
      .map((i) => contacts[i])
      .sort((a, b) => {
        const pa = preferencePriority(a);
        const pb = preferencePriority(b);
        if (pa !== pb) return pb - pa; // vyšší skóre = primárka
        // tiebreaker: starší createdAt = primárka
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
    const primary = sorted[0];
    const secondaries = sorted.slice(1).map((c) => c.id);

    try {
      const result = await mergeContacts(session.uid, primary.id, secondaries);
      if (result.ok) {
        merged += result.mergedCount;
        mergedClusters++;
      } else {
        errors++;
      }
    } catch (e) {
      console.warn("[auto-merge] cluster err:", e instanceof Error ? e.message : e);
      errors++;
    }
  }

  return Response.json({
    ok: true,
    totalClusters: Array.from(clusters.values()).filter((m) => m.length >= 2).length,
    mergedClusters,
    contactsRemoved: merged,
    errors,
  });
};
