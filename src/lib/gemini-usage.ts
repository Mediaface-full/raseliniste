/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from "./db";
import { getGeminiMode } from "./gemini";

/**
 * AI usage tracking — log každého Gemini volání pro ekonomický přehled.
 *
 * Volá se po každém `generateContent` jako side-effect:
 *   const response = await genai.models.generateContent({...});
 *   trackGeminiCall("briefing", response, ANALYSIS_MODEL, durationMs).catch(() => null);
 *
 * NIKDY nethrowne nahoru. Pokud DB write selže, jen warn log a pokračuj.
 *
 * Cenovník: Google Gemini 2.5 (per 1M tokens, USD).
 * Aktualizováno 2026-04, kontrolovat 1× ročně:
 *   https://ai.google.dev/gemini-api/docs/pricing
 */

interface ModelPricing {
  inputUsdPer1M: number;
  outputUsdPer1M: number;
  audioInputUsdPer1M?: number;  // pokud je vstup audio
}

const PRICING: Record<string, ModelPricing> = {
  "gemini-2.5-flash": {
    inputUsdPer1M: 0.30,
    outputUsdPer1M: 2.50,
    audioInputUsdPer1M: 1.00,
  },
  "gemini-2.5-pro": {
    inputUsdPer1M: 1.25,
    outputUsdPer1M: 10.00,
    audioInputUsdPer1M: 1.25,
  },
  // Fallback pro neznámé modely (zhruba Pro úroveň pro safety)
  "_default": {
    inputUsdPer1M: 1.25,
    outputUsdPer1M: 10.00,
  },
};

const USD_TO_CZK = 22.5; // přibližný kurz, lze v budoucnu načíst z env

export type AiModule =
  | "briefing"               // noční briefing (Pro)
  | "task-extract"           // /ukoly/audio Stage 2 extrakce úkolů (Pro)
  | "audio-stage1-transcribe" // všechna audio Stage 1 přepis (Flash)
  | "audio-stage2-analyze"   // Studna Stage 2 analýza (Flash/Pro)
  | "event-classifier"       // klasifikace EventType (Flash)
  | "event-parser"           // /quickadd parser (Flash)
  | "journal-redact"         // deník AI redakce (Flash)
  | "letter-redact"          // dopisy "Učesat" (Flash)
  | "health-analyze"         // měsíční zdravotní analýza (Pro)
  | "project-summary"        // Studna projektový souhrn (Pro)
  | "ai-chat"                // /api/ai/chat (Flash)
  | "capture-classifier"     // Capture klasifikace (Flash)
  | "health-check";          // /api/health/ai test ping

export interface TrackInput {
  module: AiModule | string;
  /** Gemini response object (response.usageMetadata) */
  response: any;
  modelName: string;
  durationMs?: number;
  userId?: string | null;
  success?: boolean;
  errorMsg?: string | null;
}

/**
 * Vypočítej náklad pro daný počet tokenů (USD).
 */
export function calculateCost(
  modelName: string,
  inputTokens: number,
  outputTokens: number,
): { usd: number; czk: number } {
  const pricing = PRICING[modelName] ?? PRICING._default;
  const inputCost = (inputTokens / 1_000_000) * pricing.inputUsdPer1M;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputUsdPer1M;
  const usd = inputCost + outputCost;
  return { usd, czk: usd * USD_TO_CZK };
}

/**
 * Hlavní entry point. Volá se po každém generateContent.
 * NIKDY nethrowne.
 */
export async function trackGeminiCall(input: TrackInput): Promise<void> {
  try {
    const usage = input.response?.usageMetadata ?? {};
    const inputTokens = Number(usage.promptTokenCount ?? 0);
    const outputTokens = Number(usage.candidatesTokenCount ?? usage.totalTokenCount ?? 0) - inputTokens;
    const safeOutput = Math.max(0, outputTokens);

    const { usd, czk } = calculateCost(input.modelName, inputTokens, safeOutput);

    await prisma.aiUsageLog.create({
      data: {
        userId: input.userId ?? null,
        module: input.module,
        model: input.modelName,
        mode: getGeminiMode(),
        inputTokens,
        outputTokens: safeOutput,
        costUsd: usd,
        costCzk: czk,
        durationMs: input.durationMs ?? 0,
        success: input.success ?? true,
        errorMsg: input.errorMsg ?? null,
      },
    });
  } catch (e) {
    console.warn("[gemini-usage] tracking failed:", e instanceof Error ? e.message : String(e));
  }
}

/**
 * Zaloguj failed call (žádné usageMetadata — jen že se to nepovedlo).
 */
export async function trackGeminiError(params: {
  module: string;
  modelName: string;
  errorMsg: string;
  durationMs?: number;
  userId?: string | null;
}): Promise<void> {
  try {
    await prisma.aiUsageLog.create({
      data: {
        userId: params.userId ?? null,
        module: params.module,
        model: params.modelName,
        mode: getGeminiMode(),
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        costCzk: 0,
        durationMs: params.durationMs ?? 0,
        success: false,
        errorMsg: params.errorMsg.slice(0, 1000),
      },
    });
  } catch (e) {
    console.warn("[gemini-usage] error tracking failed:", e);
  }
}

/**
 * Wrapper kolem `genai.models.generateContent` (nebo jakéhokoliv async Gemini volání).
 * Měří čas, loguje success/error.
 *
 * Použití:
 *   const response = await callTracked({
 *     module: "briefing",
 *     modelName: ANALYSIS_MODEL,
 *     userId: session.uid,
 *     fn: () => genai.models.generateContent({...}),
 *   });
 */
export async function callTracked<T>(opts: {
  module: AiModule | string;
  modelName: string;
  userId?: string | null;
  fn: () => Promise<T>;
}): Promise<T> {
  const t0 = Date.now();
  try {
    const result = await opts.fn();
    const durationMs = Date.now() - t0;
    void trackGeminiCall({
      module: opts.module,
      response: result,
      modelName: opts.modelName,
      durationMs,
      userId: opts.userId ?? null,
      success: true,
    });
    return result;
  } catch (e) {
    const durationMs = Date.now() - t0;
    const msg = e instanceof Error ? e.message : String(e);
    void trackGeminiError({
      module: opts.module,
      modelName: opts.modelName,
      errorMsg: msg,
      durationMs,
      userId: opts.userId ?? null,
    });
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Aggregations pro UI
// ---------------------------------------------------------------------------

export interface UsageStats {
  period: { from: Date; to: Date };
  total: { calls: number; inputTokens: number; outputTokens: number; usd: number; czk: number };
  byModule: Array<{ module: string; calls: number; inputTokens: number; outputTokens: number; usd: number; czk: number; avgCzkPerCall: number }>;
  byModel: Array<{ model: string; calls: number; usd: number; czk: number }>;
  byDay: Array<{ day: string; calls: number; czk: number; byModule: Record<string, number> }>;
  recentCalls: Array<{
    id: string; at: Date; module: string; model: string; mode: string;
    inputTokens: number; outputTokens: number; czk: number; durationMs: number;
    success: boolean; errorMsg: string | null;
  }>;
}

export async function getUsageStats(options: {
  fromDate: Date;
  toDate: Date;
}): Promise<UsageStats> {
  const logs = await prisma.aiUsageLog.findMany({
    where: { at: { gte: options.fromDate, lte: options.toDate } },
    orderBy: { at: "desc" },
  });

  const total = {
    calls: logs.length,
    inputTokens: logs.reduce((s, l) => s + l.inputTokens, 0),
    outputTokens: logs.reduce((s, l) => s + l.outputTokens, 0),
    usd: logs.reduce((s, l) => s + l.costUsd, 0),
    czk: logs.reduce((s, l) => s + l.costCzk, 0),
  };

  // By module
  const moduleMap = new Map<string, { calls: number; inputTokens: number; outputTokens: number; usd: number; czk: number }>();
  for (const l of logs) {
    const m = moduleMap.get(l.module) ?? { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0, czk: 0 };
    m.calls++;
    m.inputTokens += l.inputTokens;
    m.outputTokens += l.outputTokens;
    m.usd += l.costUsd;
    m.czk += l.costCzk;
    moduleMap.set(l.module, m);
  }
  const byModule = Array.from(moduleMap.entries())
    .map(([module, v]) => ({ module, ...v, avgCzkPerCall: v.calls ? v.czk / v.calls : 0 }))
    .sort((a, b) => b.czk - a.czk);

  // By model
  const modelMap = new Map<string, { calls: number; usd: number; czk: number }>();
  for (const l of logs) {
    const m = modelMap.get(l.model) ?? { calls: 0, usd: 0, czk: 0 };
    m.calls++;
    m.usd += l.costUsd;
    m.czk += l.costCzk;
    modelMap.set(l.model, m);
  }
  const byModel = Array.from(modelMap.entries())
    .map(([model, v]) => ({ model, ...v }))
    .sort((a, b) => b.czk - a.czk);

  // By day
  const dayMap = new Map<string, { calls: number; czk: number; byModule: Record<string, number> }>();
  for (const l of logs) {
    const day = l.at.toISOString().slice(0, 10);
    const d = dayMap.get(day) ?? { calls: 0, czk: 0, byModule: {} };
    d.calls++;
    d.czk += l.costCzk;
    d.byModule[l.module] = (d.byModule[l.module] ?? 0) + l.costCzk;
    dayMap.set(day, d);
  }
  const byDay = Array.from(dayMap.entries())
    .map(([day, v]) => ({ day, ...v }))
    .sort((a, b) => a.day.localeCompare(b.day));

  // Recent 50
  const recentCalls = logs.slice(0, 50).map((l) => ({
    id: l.id,
    at: l.at,
    module: l.module,
    model: l.model,
    mode: l.mode,
    inputTokens: l.inputTokens,
    outputTokens: l.outputTokens,
    czk: l.costCzk,
    durationMs: l.durationMs,
    success: l.success,
    errorMsg: l.errorMsg,
  }));

  return {
    period: { from: options.fromDate, to: options.toDate },
    total,
    byModule,
    byModel,
    byDay,
    recentCalls,
  };
}
