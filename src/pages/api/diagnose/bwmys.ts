import type { APIRoute } from "astro";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/session";
import { getGeminiMode } from "@/lib/gemini";

export const prerender = false;

/**
 * GET /api/diagnose/bwmys
 *
 * Stav AI processing pro Myší modul + zdravotní analýzy + projektové souhrny.
 * Otevři v prohlížeči, JSON má pole `conclusions` co řekne kde to vázne.
 *
 * Pokrývá:
 *   - DecisionEntry status (audio entries)
 *   - DecisionEvaluation status (mini + finální)
 *   - HealthAnalysis status
 *   - ProjectSummary status
 *   - Migrace _prisma_migrations
 *   - Gemini mode (Vertex / API key / nic)
 */
export const GET: APIRoute = async ({ cookies }) => {
  const session = await readSession(cookies);
  if (!session) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  const now = Date.now();
  const ageMin = (d: Date) => Math.round((now - d.getTime()) / 60_000);

  // -------------------------------------------------------------------------
  // Stuck processing rows napříč všemi dlouhými AI joby
  // -------------------------------------------------------------------------
  const decisionEntriesProcessing = await prisma.decisionEntry.findMany({
    where: {
      decision: { userId: session.uid },
      status: "processing",
    },
    orderBy: { datum: "desc" },
    take: 20,
    select: {
      id: true, datum: true, obsah: true,
      decision: { select: { id: true, nazev: true } },
    },
  });

  const decisionEvalsProcessing = await prisma.decisionEvaluation.findMany({
    where: {
      decision: { userId: session.uid },
      status: "processing",
    },
    orderBy: { datum: "desc" },
    take: 20,
    select: {
      id: true, datum: true, typ: true,
      decision: { select: { id: true, nazev: true } },
    },
  });

  const healthProcessing = await prisma.healthAnalysis.findMany({
    where: { userId: session.uid, status: "processing" },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, createdAt: true, periodFrom: true, periodTo: true },
  });

  const summaryProcessing = await prisma.projectSummary.findMany({
    where: { project: { userId: session.uid }, status: "processing" },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true, createdAt: true,
      project: { select: { id: true, name: true } },
    },
  });

  // -------------------------------------------------------------------------
  // Errory za 24 h
  // -------------------------------------------------------------------------
  const since24h = new Date(now - 24 * 60 * 60 * 1000);
  const decisionEvalErrors = await prisma.decisionEvaluation.findMany({
    where: {
      decision: { userId: session.uid },
      status: "error",
      datum: { gte: since24h },
    },
    orderBy: { datum: "desc" },
    take: 10,
    select: {
      id: true, datum: true, typ: true, processingError: true,
      decision: { select: { id: true, nazev: true } },
    },
  });

  const decisionEntryErrors = await prisma.decisionEntry.findMany({
    where: {
      decision: { userId: session.uid },
      status: "error",
      datum: { gte: since24h },
    },
    orderBy: { datum: "desc" },
    take: 10,
    select: {
      id: true, datum: true, processingError: true,
      decision: { select: { id: true, nazev: true } },
    },
  });

  const healthErrors = await prisma.healthAnalysis.findMany({
    where: { userId: session.uid, status: "error", createdAt: { gte: since24h } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, createdAt: true, processingError: true },
  });

  const summaryErrors = await prisma.projectSummary.findMany({
    where: { project: { userId: session.uid }, status: "error", createdAt: { gte: since24h } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true, createdAt: true, processingError: true,
      project: { select: { id: true, name: true } },
    },
  });

  // -------------------------------------------------------------------------
  // Migrace check — ověř že nové migrace prošly
  // -------------------------------------------------------------------------
  const expectedMigrations = [
    "20260506110000_add_decision_entry_status",
    "20260506120000_add_decision_evaluation_status",
    "20260506130000_add_project_file",
    "20260506140000_add_health_summary_status",
  ];
  const appliedMigrations = await prisma.$queryRawUnsafe<{ migration_name: string; finished_at: Date | null }[]>(
    `SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE migration_name = ANY($1::text[]) ORDER BY finished_at DESC NULLS LAST`,
    expectedMigrations,
  ).catch(() => []);

  const missingMigrations = expectedMigrations.filter(
    (name) => !appliedMigrations.find((m) => m.migration_name === name && m.finished_at),
  );

  // -------------------------------------------------------------------------
  // Gemini mode + ENV
  // -------------------------------------------------------------------------
  const geminiMode = getGeminiMode();
  const hasGcpKey = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  const hasApiKey = Boolean(process.env.GEMINI_API_KEY);

  // -------------------------------------------------------------------------
  // Conclusions — automatické vyhodnocení
  // -------------------------------------------------------------------------
  const conclusions: string[] = [];
  const STALE_MIN = 5;

  if (missingMigrations.length > 0) {
    conclusions.push(
      `🔴 CHYBÍ MIGRACE: ${missingMigrations.join(", ")}. Bez nich endpointy padají při create. Spusť rebuild kontejneru.`,
    );
  } else {
    conclusions.push("🟢 Všechny očekávané migrace aplikovány.");
  }

  if (!hasGcpKey && !hasApiKey) {
    conclusions.push("🔴 Žádné AI credentials — chybí GOOGLE_APPLICATION_CREDENTIALS i GEMINI_API_KEY.");
  } else {
    conclusions.push(`🟢 Gemini mode: ${geminiMode} (Vertex=${hasGcpKey ? "✓" : "✗"}, API key=${hasApiKey ? "✓" : "✗"})`);
  }

  // Stuck rows
  const stuckEntries = decisionEntriesProcessing.filter((e) => ageMin(e.datum) >= STALE_MIN);
  const stuckEvals = decisionEvalsProcessing.filter((e) => ageMin(e.datum) >= STALE_MIN);
  const stuckHealth = healthProcessing.filter((h) => ageMin(h.createdAt) >= STALE_MIN);
  const stuckSummary = summaryProcessing.filter((s) => ageMin(s.createdAt) >= STALE_MIN);
  const stuckTotal = stuckEntries.length + stuckEvals.length + stuckHealth.length + stuckSummary.length;

  if (stuckTotal > 0) {
    conclusions.push(
      `🟡 ${stuckTotal} stuck row(s) starších 5 min (${stuckEntries.length} entry, ${stuckEvals.length} eval, ${stuckHealth.length} health, ${stuckSummary.length} summary). Otevři detail nebo refreshni — lazy cleanup je překlopí na error.`,
    );
  }

  if (decisionEntriesProcessing.length === 0 && decisionEvalsProcessing.length === 0 && healthProcessing.length === 0 && summaryProcessing.length === 0) {
    conclusions.push("🟢 Žádné aktivní processing joby — vše dokončeno nebo nic neběží.");
  } else {
    const young = decisionEntriesProcessing.length + decisionEvalsProcessing.length + healthProcessing.length + summaryProcessing.length - stuckTotal;
    if (young > 0) conclusions.push(`🟢 ${young} aktivní AI job(y) běží na pozadí (mladší 5 min).`);
  }

  // Errory
  const totalErrors = decisionEvalErrors.length + decisionEntryErrors.length + healthErrors.length + summaryErrors.length;
  if (totalErrors > 0) {
    conclusions.push(`🟡 ${totalErrors} AI selhání za posledních 24 h. Detail v poli "errors24h" — typicky Gemini timeout, JSON parse, nebo rate limit.`);
  } else {
    conclusions.push("🟢 Žádné AI selhání za posledních 24 h.");
  }

  return Response.json({
    timestamp: new Date().toISOString(),
    geminiMode,
    env: {
      hasGcpKey,
      hasApiKey,
    },
    migrations: {
      expected: expectedMigrations,
      applied: appliedMigrations,
      missing: missingMigrations,
    },
    processing: {
      decisionEntries: decisionEntriesProcessing.map((e) => ({
        id: e.id,
        decisionId: e.decision.id,
        decisionName: e.decision.nazev,
        ageMin: ageMin(e.datum),
        obsahPreview: e.obsah.slice(0, 100),
      })),
      decisionEvaluations: decisionEvalsProcessing.map((e) => ({
        id: e.id,
        decisionId: e.decision.id,
        decisionName: e.decision.nazev,
        typ: e.typ,
        ageMin: ageMin(e.datum),
      })),
      healthAnalyses: healthProcessing.map((h) => ({
        id: h.id,
        ageMin: ageMin(h.createdAt),
        period: { from: h.periodFrom, to: h.periodTo },
      })),
      projectSummaries: summaryProcessing.map((s) => ({
        id: s.id,
        projectId: s.project.id,
        projectName: s.project.name,
        ageMin: ageMin(s.createdAt),
      })),
    },
    errors24h: {
      decisionEntries: decisionEntryErrors,
      decisionEvaluations: decisionEvalErrors,
      healthAnalyses: healthErrors,
      projectSummaries: summaryErrors,
    },
    conclusions,
  });
};
