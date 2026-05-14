/**
 * POST /api/studna/recordings/delete-empty-audio
 *
 * Petr 2026-05-14: po fix MIME a retry zůstávají nahrávky s 0-byte audio
 * (cleanup-audio cron je smazal po 14 dnech, klient nahrál prazdný blob,
 * atd.). Nelze je obnovit — tahle utilitka je smaže napříč VŠEMI moduly:
 *   - ProjectRecording (Studánka, Prskavka)
 *   - Recording (Ozvěna úkoly/deník v staré pipeline)
 *   - Task (audio z Ozvěny)
 *   - JournalEntry (deník)
 *   - DecisionEntry (B&W Myš)
 *
 * Najde status=error AND (audioPath neexistuje NEBO soubor má 0 bytes) →
 * delete row z DB.
 *
 * Vrací souhrn { totalScanned, totalDeleted, perModel: {...} }.
 */

import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { uploadExists, resolveUpload } from "@/lib/uploads";
import { stat } from "node:fs/promises";

export const prerender = false;

async function isAudioMissing(audioPath: string | null): Promise<{ missing: boolean; reason: string }> {
  if (!audioPath) return { missing: true, reason: "no audioPath" };
  const exists = await uploadExists(audioPath);
  if (!exists) return { missing: true, reason: "audio missing on disk" };
  try {
    const s = await stat(resolveUpload(audioPath));
    if (s.size === 0) return { missing: true, reason: "0-byte audio file" };
    return { missing: false, reason: "" };
  } catch {
    return { missing: true, reason: "stat failed" };
  }
}

export const POST: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const userId = session.uid;
  const perModel: Record<string, { scanned: number; deleted: number; details: Array<{ id: string; reason: string }> }> = {};

  // 1) ProjectRecording (Studánka + Prskavka) — userId přes project.userId
  {
    const rows = await prisma.projectRecording.findMany({
      where: { status: "error", project: { userId } },
      select: { id: true, audioPath: true },
    });
    const toDelete: Array<{ id: string; reason: string }> = [];
    for (const r of rows) {
      const check = await isAudioMissing(r.audioPath);
      if (check.missing) toDelete.push({ id: r.id, reason: check.reason });
    }
    if (toDelete.length > 0) {
      await prisma.projectRecording.deleteMany({ where: { id: { in: toDelete.map((t) => t.id) } } });
    }
    perModel.projectRecording = { scanned: rows.length, deleted: toDelete.length, details: toDelete.slice(0, 20) };
  }

  // 2) Recording (Ozvěna stará pipeline) — audio přes ProjectRecording-like; jen pokud má audioPath
  // (Pozn.: Recording model nemá status pole, ale processingError; pojmenování v DB se může lišit)
  try {
    const rows = await prisma.recording.findMany({
      where: { userId, processingError: { not: null } },
      select: { id: true },
    });
    // Recording nemá audioPath přímo — přeskočíme. Audio je v audioBlobs nebo
    // jiné struktuře specifické tomuto modelu. Necháme to bez zásahu.
    perModel.recording = { scanned: rows.length, deleted: 0, details: [] };
  } catch {
    perModel.recording = { scanned: 0, deleted: 0, details: [] };
  }

  // 3) Task — audio z Ozvěny "úkol"
  {
    const rows = await prisma.task.findMany({
      where: { userId, status: "error", audioPath: { not: null } },
      select: { id: true, audioPath: true },
    });
    const toDelete: Array<{ id: string; reason: string }> = [];
    for (const r of rows) {
      const check = await isAudioMissing(r.audioPath);
      if (check.missing) toDelete.push({ id: r.id, reason: check.reason });
    }
    // U Tasks NEMAŽEME celý task — jen ho označíme jako bez audio (clear audioPath/error)
    // protože Task má textový obsah který chce uživatel mít.
    if (toDelete.length > 0) {
      await prisma.task.updateMany({
        where: { id: { in: toDelete.map((t) => t.id) } },
        data: { audioPath: null, audioMime: null, audioBytes: null, status: "ready", processingError: null },
      });
    }
    perModel.task = { scanned: rows.length, deleted: toDelete.length, details: toDelete.slice(0, 20) };
  }

  // 4) JournalEntry — deník
  {
    const rows = await prisma.journalEntry.findMany({
      where: { userId, status: "error", audioPath: { not: null } },
      select: { id: true, audioPath: true },
    });
    const toDelete: Array<{ id: string; reason: string }> = [];
    for (const r of rows) {
      const check = await isAudioMissing(r.audioPath);
      if (check.missing) toDelete.push({ id: r.id, reason: check.reason });
    }
    if (toDelete.length > 0) {
      await prisma.journalEntry.updateMany({
        where: { id: { in: toDelete.map((t) => t.id) } },
        data: { audioPath: null, audioMime: null, audioBytes: null, status: "ready", processingError: null },
      });
    }
    perModel.journalEntry = { scanned: rows.length, deleted: toDelete.length, details: toDelete.slice(0, 20) };
  }

  // 5) DecisionEntry (B&W Myš) — clear audio jen, neaž entry samotnou
  {
    const rows = await prisma.decisionEntry.findMany({
      where: { decision: { userId }, status: "error", audioPath: { not: null } },
      select: { id: true, audioPath: true },
    });
    const toDelete: Array<{ id: string; reason: string }> = [];
    for (const r of rows) {
      const check = await isAudioMissing(r.audioPath);
      if (check.missing) toDelete.push({ id: r.id, reason: check.reason });
    }
    if (toDelete.length > 0) {
      await prisma.decisionEntry.updateMany({
        where: { id: { in: toDelete.map((t) => t.id) } },
        data: { audioPath: null, audioMime: null, audioBytes: null, status: "ready", processingError: null },
      });
    }
    perModel.decisionEntry = { scanned: rows.length, deleted: toDelete.length, details: toDelete.slice(0, 20) };
  }

  const totalScanned = Object.values(perModel).reduce((s, m) => s + m.scanned, 0);
  const totalDeleted = Object.values(perModel).reduce((s, m) => s + m.deleted, 0);

  return Response.json({
    ok: true,
    totalScanned,
    totalDeleted,
    perModel,
    note: "ProjectRecording mazáno celé (sloupec záznamu). Task/JournalEntry/DecisionEntry: vyčištěno jen audio, textový obsah zůstává.",
  });
};
