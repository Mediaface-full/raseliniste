import { getGemini, ANALYSIS_MODEL } from "./gemini";
import { callTracked } from "./gemini-usage";
import {
  AGGREGATION_MAP,
  queryBloodPressure,
  querySimpleMetric,
  querySleep,
  type DayPoint,
  type SeriesStats,
} from "./health-query";

const SYSTEM_PROMPT = `Jsi zdravotní analytik Petra (Gideona). Dostáváš statistická data
z jeho Apple Watch a iPhonu přes Apple Health za určené období.

DŮLEŽITÉ: NEJSI LÉKAŘ. Nediagnostikuj nemoci. Nenavrhuj změny v medikaci.
Pokud vidíš něco znepokojivého, doporuč KONZULTACI s lékařem, ne konkrétní diagnózu.
Nespekuluj. Nehroť. Pracuj jen s čísly, která máš.

Tvůj úkol: dát pragmatické, přímé vhledy. Češtinou. V markdown.

Struktura výstupu (vždy):

## Souhrn
2–3 věty co období vyjadřuje jako celek. Zmiň počet dní a počet záznamů.

## Co je v pořádku
- bullety, konkrétní čísla
- zmiň jen to, co je reálně v normě/dobré

## Co stojí za pozornost
- trendy, změny, odchylky od baseline
- konkrétní čísla, konkrétní období (např. "posledních 7 dní HRV kleslo z 45 ms na 28 ms")

## Varovné signály
(Jen pokud existují — jinak sekci vynech. Ne víc než 3 body.)
- založené na objektivních mezních hodnotách (např. klidový tep dlouhodobě > 80 bpm,
  průměrný spánek < 6 h, systolický tlak > 140, HRV drop > 30 % meziměsíčně)

## Doporučení
- 3–5 konkrétních akcí
- ne obecné "pij vodu a spi víc", ale vázané na data
- pokud data nestačí na konkrétní doporučení, řekni to

Pravidla:
1. Nevymýšlej data. Pracuj jen s tím, co ti bylo dodáno.
2. Pokud má metrika méně než 5 záznamů v období, zmiň to a nespekuluj z toho.
3. Čísla formátuj česky (tisíce mezerou, desetinná čárka).
4. Žádné emoji nádeníček, ale 1–2 decentní ikony/emoji na sekci OK (např. ⚠️ u varování).
5. Celá odpověď max ~600 slov.
6. Pokud uživatel přidal focus ("co mám sledovat"), zaměř se primárně na to.`;

type ReducedSeries = {
  type: string;
  unit: string | null;
  stats: SeriesStats;
  aggregation: "sum" | "avg" | "latest";
  sample: Array<{ date: string; value: number }>; // agregováno na max ~40 bodů
};

type ReducedBp = {
  count: number;
  systolic: SeriesStats;
  diastolic: SeriesStats;
  sample: Array<{ date: string; systolic: number; diastolic: number }>;
};

type ReducedSleep = {
  count: number;
  total: SeriesStats;
  deep: SeriesStats;
  rem: SeriesStats;
  sample: Array<{ date: string; total: number; deep: number; rem: number; core: number; awake: number }>;
};

/**
 * Downsample: z N bodů udělej max `target` rovnoměrně rozmístěných bodů.
 * Pro N <= target vrací původní pole.
 */
function downsample<T>(points: T[], target: number): T[] {
  if (points.length <= target) return points;
  const step = points.length / target;
  const out: T[] = [];
  for (let i = 0; i < target; i++) {
    out.push(points[Math.floor(i * step)]);
  }
  // přidej poslední bod aby byl tail zahrnutý
  if (out[out.length - 1] !== points[points.length - 1]) {
    out.push(points[points.length - 1]);
  }
  return out;
}

function fmtStat(s: SeriesStats, unit: string | null, decimals = 1): string {
  if (s.count === 0) return "—";
  const u = unit ? ` ${unit}` : "";
  const trend = s.trendPct == null ? "" : ` | trend ${s.trendPct > 0 ? "+" : ""}${s.trendPct.toFixed(1)}%`;
  return `n=${s.count}, avg ${s.avg?.toFixed(decimals)}${u}, min ${s.min?.toFixed(decimals)}, max ${s.max?.toFixed(decimals)}${trend}`;
}

function fmtDayPoint(p: { date: string; value: number }, decimals = 0): string {
  return `${p.date}: ${p.value.toFixed(decimals)}`;
}

function buildUserPrompt(
  from: Date,
  to: Date,
  focus: string | null,
  simples: ReducedSeries[],
  bp: ReducedBp | null,
  sleep: ReducedSleep | null
): string {
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  const lines: string[] = [];

  lines.push(`# Zdravotní data Petra`);
  lines.push(``);
  lines.push(`Období: ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)} (${days} dní)`);
  if (focus) {
    lines.push(``);
    lines.push(`**Uživatel si přeje se zaměřit na:** ${focus}`);
  }
  lines.push(``);
  lines.push(`---`);
  lines.push(``);
  lines.push(`## Souhrn metrik`);
  lines.push(``);

  // Aktivita
  const activityTypes = ["step_count", "active_energy", "walking_running_distance", "flights_climbed", "apple_exercise_time", "apple_stand_time"];
  const heartTypes = ["resting_heart_rate", "heart_rate_variability", "respiratory_rate", "cardio_recovery"];
  const bodyTypes = ["weight_body_mass", "body_fat_percentage", "walking_step_length"];
  const otherTypes = ["physical_effort", "basal_energy_burned"];

  const showGroup = (title: string, types: string[]) => {
    const rows = simples.filter((s) => types.includes(s.type) && s.stats.count > 0);
    if (rows.length === 0) return;
    lines.push(`### ${title}`);
    for (const r of rows) {
      const decimals = r.unit === "km" || r.unit === "ms" || r.unit === "kg" || r.unit === "%" ? 1 : 0;
      lines.push(`- **${r.type}** (${r.aggregation} / ${r.unit ?? "?"}): ${fmtStat(r.stats, r.unit, decimals)}`);
    }
    lines.push(``);
  };

  showGroup("Aktivita", activityTypes);
  showGroup("Srdce & dech", heartTypes);
  showGroup("Tělo", bodyTypes);
  showGroup("Ostatní", otherTypes);

  if (bp && bp.count > 0) {
    lines.push(`### Krevní tlak`);
    lines.push(`- měření: ${bp.count}`);
    lines.push(`- systolický: ${fmtStat(bp.systolic, "mmHg", 0)}`);
    lines.push(`- diastolický: ${fmtStat(bp.diastolic, "mmHg", 0)}`);
    lines.push(``);
  }

  if (sleep && sleep.count > 0) {
    lines.push(`### Spánek`);
    lines.push(`- nocí: ${sleep.count}`);
    lines.push(`- celkový spánek (h): ${fmtStat(sleep.total, "h", 2)}`);
    lines.push(`- hluboký (h): ${fmtStat(sleep.deep, "h", 2)}`);
    lines.push(`- REM (h): ${fmtStat(sleep.rem, "h", 2)}`);
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(``);
  lines.push(`## Časové řady (downsample max ~40 bodů)`);
  lines.push(``);

  for (const r of simples) {
    if (r.sample.length === 0) continue;
    const decimals = r.unit === "km" || r.unit === "ms" || r.unit === "kg" || r.unit === "%" ? 1 : 0;
    lines.push(`### ${r.type} (${r.unit ?? "?"})`);
    lines.push(r.sample.map((p) => fmtDayPoint(p, decimals)).join("; "));
    lines.push(``);
  }

  if (bp && bp.sample.length > 0) {
    lines.push(`### Krevní tlak (systolic / diastolic mmHg)`);
    lines.push(bp.sample.map((p) => `${p.date.slice(0, 10)}: ${p.systolic}/${p.diastolic}`).join("; "));
    lines.push(``);
  }

  if (sleep && sleep.sample.length > 0) {
    lines.push(`### Spánek denní rozpad (h)`);
    lines.push(
      sleep.sample
        .map((p) => `${p.date}: total ${p.total.toFixed(1)} | deep ${p.deep.toFixed(1)} | rem ${p.rem.toFixed(1)} | core ${p.core.toFixed(1)} | awake ${p.awake.toFixed(1)}`)
        .join("; ")
    );
    lines.push(``);
  }

  return lines.join("\n");
}

export type AnalyzeResult = {
  text: string;
  meta: {
    from: string;
    to: string;
    days: number;
    totalSamples: number;
    metricsWithData: number;
    model: string;
    promptChars: number;
  };
};

/**
 * Stáhne data, downsampluje, postaví prompt, zavolá Gemini Pro, vrátí text.
 */
export async function analyzeHealth(
  userId: string,
  from: Date,
  to: Date,
  focus: string | null
): Promise<AnalyzeResult> {
  const TARGET_POINTS = 40;

  const simpleTypes = Object.keys(AGGREGATION_MAP);

  const [simples, bp, sleep] = await Promise.all([
    Promise.all(
      simpleTypes.map(async (type) => {
        const r = await querySimpleMetric(userId, type, from, to, AGGREGATION_MAP[type]);
        return {
          type,
          unit: r.unit,
          stats: r.stats,
          aggregation: AGGREGATION_MAP[type],
          sample: downsample(r.points, TARGET_POINTS).map((p: DayPoint) => ({
            date: p.date,
            value: p.value,
          })),
        } satisfies ReducedSeries;
      })
    ),
    queryBloodPressure(userId, from, to),
    querySleep(userId, from, to),
  ]);

  const reducedBp: ReducedBp | null = bp.points.length > 0
    ? {
        count: bp.points.length,
        systolic: bp.systolicStats,
        diastolic: bp.diastolicStats,
        sample: downsample(bp.points, TARGET_POINTS),
      }
    : null;

  const reducedSleep: ReducedSleep | null = sleep.points.length > 0
    ? {
        count: sleep.points.length,
        total: sleep.totalStats,
        deep: sleep.deepStats,
        rem: sleep.remStats,
        sample: downsample(sleep.points, TARGET_POINTS).map((p) => ({
          date: p.date,
          total: p.total,
          deep: p.deep,
          rem: p.rem,
          core: p.core,
          awake: p.awake,
        })),
      }
    : null;

  const userPrompt = buildUserPrompt(from, to, focus, simples, reducedBp, reducedSleep);

  const gemini = getGemini();
  const response = await callTracked({
    module: "health-analyze",
    modelName: ANALYSIS_MODEL,
    fn: () => gemini.models.generateContent({
      model: ANALYSIS_MODEL,
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0.4,
      },
    }),
  });

  const text = response.text ?? "";
  if (!text) throw new Error("Gemini vrátila prázdnou odpověď");

  const totalSamples =
    simples.reduce((n, s) => n + s.stats.count, 0) +
    (reducedBp?.count ?? 0) +
    (reducedSleep?.count ?? 0);
  const metricsWithData = simples.filter((s) => s.stats.count > 0).length
    + (reducedBp ? 1 : 0)
    + (reducedSleep ? 1 : 0);

  return {
    text,
    meta: {
      from: from.toISOString(),
      to: to.toISOString(),
      days: Math.round((to.getTime() - from.getTime()) / 86_400_000),
      totalSamples,
      metricsWithData,
      model: ANALYSIS_MODEL,
      promptChars: userPrompt.length,
    },
  };
}
