// Předpověď počasí pro dashboard (Petr 2026-07-15) — Open-Meteo, zdarma,
// bez API klíče. Modulová cache 30 min (jediný uživatel, netřeba víc).
// Při výpadku API vrací null — dashboard chipy prostě nevykreslí.

// Jílové u Prahy (domov)
const LAT = 49.8939;
const LON = 14.4938;
const CACHE_TTL_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2500;

export interface WeatherDay {
  date: string;      // YYYY-MM-DD
  icon: string;      // lucide icon name
  label: string;     // "jasno", "déšť"…
  tMax: number;      // °C zaokrouhleno
  tMin: number;
}

// WMO weather code → lucide ikona + český popisek
// https://open-meteo.com/en/docs (WMO Weather interpretation codes)
function mapWmo(code: number): { icon: string; label: string } {
  if (code === 0) return { icon: "lucide:sun", label: "jasno" };
  if (code === 1) return { icon: "lucide:sun-medium", label: "skoro jasno" };
  if (code === 2) return { icon: "lucide:cloud-sun", label: "polojasno" };
  if (code === 3) return { icon: "lucide:cloud", label: "zataženo" };
  if (code === 45 || code === 48) return { icon: "lucide:cloud-fog", label: "mlha" };
  if (code >= 51 && code <= 57) return { icon: "lucide:cloud-drizzle", label: "mrholení" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { icon: "lucide:cloud-rain", label: "déšť" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: "lucide:cloud-snow", label: "sněžení" };
  if (code >= 95) return { icon: "lucide:cloud-lightning", label: "bouřky" };
  return { icon: "lucide:cloud", label: "oblačno" };
}

let cache: { fetchedAt: number; data: WeatherDay[] } | null = null;

export async function getForecast3Days(): Promise<WeatherDay[] | null> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.data;

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min` +
      `&timezone=Europe%2FPrague&forecast_days=3`;
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`open-meteo ${res.status}`);
    const json = (await res.json()) as {
      daily?: {
        time?: string[];
        weather_code?: number[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
      };
    };
    const d = json.daily;
    if (!d?.time || !d.weather_code || !d.temperature_2m_max || !d.temperature_2m_min) {
      throw new Error("open-meteo: unexpected shape");
    }
    const data: WeatherDay[] = d.time.map((date, i) => ({
      date,
      ...mapWmo(d.weather_code![i]),
      tMax: Math.round(d.temperature_2m_max![i]),
      tMin: Math.round(d.temperature_2m_min![i]),
    }));
    cache = { fetchedAt: Date.now(), data };
    return data;
  } catch (e) {
    console.warn("[weather] fetch failed:", e instanceof Error ? e.message : e);
    // Stará cache je lepší než nic (i po TTL)
    return cache?.data ?? null;
  }
}
