/**
 * In-memory IP rate limit pro public Astro pages (SSR routes).
 *
 * Server běží jako singleton kontejner — Map se nemusí distribuovat.
 * Restart kontejneru reset uje counter, což je pro anti-DoS přijatelné.
 *
 * Použití:
 *   ```
 *   const ip = getIp(request, clientAddress);
 *   if (!checkPageRateLimit(ip, "call-log", 30, 60_000)) {
 *     return new Response("Too many requests", { status: 429 });
 *   }
 *   ```
 */

interface Bucket {
  count: number;
  windowStart: number;
}

const BUCKETS = new Map<string, Bucket>();

// Periodický garbage collect starých záznamů — každých 5 min vyčistíme vše
// co je starší než 1 hodina, aby Map nerostl donekonečna při high traffic.
let lastGc = Date.now();
function maybeGc() {
  const now = Date.now();
  if (now - lastGc < 5 * 60 * 1000) return;
  lastGc = now;
  const cutoff = now - 60 * 60 * 1000;
  for (const [k, b] of BUCKETS) {
    if (b.windowStart < cutoff) BUCKETS.delete(k);
  }
}

/**
 * Vrátí true pokud request je pod limitem, false pokud má být zablokován.
 *
 * @param ip Klientské IP
 * @param scope Identifikátor route (např. "call-log", "call-log-thanks")
 * @param maxPerWindow Maximum requestů v okně
 * @param windowMs Velikost okna v ms (default 60 000 = 1 min)
 */
export function checkPageRateLimit(
  ip: string,
  scope: string,
  maxPerWindow: number,
  windowMs: number = 60_000,
): boolean {
  maybeGc();
  const key = `${scope}:${ip}`;
  const now = Date.now();
  const bucket = BUCKETS.get(key);

  if (!bucket || now - bucket.windowStart >= windowMs) {
    BUCKETS.set(key, { count: 1, windowStart: now });
    return true;
  }

  bucket.count++;
  return bucket.count <= maxPerWindow;
}

export function getIp(request: Request, clientAddress: string | undefined): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return clientAddress ?? "unknown";
}
