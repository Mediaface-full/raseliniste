/**
 * Real-time progress sync — Petr 2026-05-16.
 *
 * Sync funkce (pullIcloudContacts / syncWithGoogle) updatuje User.contactsSyncProgress
 * v jednotlivých krocích. Frontend polluje GET /api/contacts/sync-progress à 2s.
 *
 * Idempotent — pokud update selže, sync pokračuje (best-effort progress, ne
 * blokující).
 */

import { prisma } from "./db";

export type SyncProvider = "icloud" | "google";
export type SyncStage =
  | "discovery"      // CardDAV discovery / OAuth setup
  | "listing"        // PROPFIND list / connections list
  | "fetching"       // REPORT multiget / individual fetch
  | "saving"         // upsert do DB
  | "merging"        // auto-merge duplicit
  | "done"
  | "error";

export interface SyncProgress {
  provider: SyncProvider;
  stage: SyncStage;
  current: number;
  total: number;
  mergedClusters: number;
  startedAt: string;
  message?: string;
  error?: string;
}

export async function startSyncProgress(userId: string, provider: SyncProvider): Promise<void> {
  const progress: SyncProgress = {
    provider,
    stage: "discovery",
    current: 0,
    total: 0,
    mergedClusters: 0,
    startedAt: new Date().toISOString(),
    message: provider === "icloud" ? "Hledám iCloud addressbook…" : "Připojuji Google Workspace…",
  };
  await prisma.user.update({
    where: { id: userId },
    data: { contactsSyncProgress: progress as unknown as object },
  }).catch(() => null);
}

export async function updateSyncProgress(
  userId: string,
  updates: Partial<SyncProgress>,
): Promise<void> {
  try {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { contactsSyncProgress: true },
    });
    const current = (u?.contactsSyncProgress ?? null) as SyncProgress | null;
    if (!current) return; // start nebyl volán, žádný update
    const next = { ...current, ...updates };
    await prisma.user.update({
      where: { id: userId },
      data: { contactsSyncProgress: next as unknown as object },
    });
  } catch {
    // ignore — progress update nesmí shodit sync
  }
}

export async function finishSyncProgress(
  userId: string,
  finalStage: "done" | "error",
  details?: { mergedClusters?: number; error?: string; message?: string; total?: number },
): Promise<void> {
  await updateSyncProgress(userId, {
    stage: finalStage,
    ...details,
  });
  // Po 30 sekundách auto-clear (pokud uživatel nezavřel tab, banner zmizí
  // a další sync začne čisto)
  setTimeout(() => {
    void clearSyncProgress(userId);
  }, 30_000);
}

export async function clearSyncProgress(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { contactsSyncProgress: null as unknown as object },
  }).catch(() => null);
}

export async function getSyncProgress(userId: string): Promise<SyncProgress | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { contactsSyncProgress: true },
  });
  return (u?.contactsSyncProgress ?? null) as SyncProgress | null;
}
