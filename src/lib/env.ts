import { z } from "zod";

/**
 * Preprocess prázdný string ("") na undefined.
 *
 * Důvod: docker-compose syntax `${VAR:-}` produkuje prázdný string, když
 * VAR není v .env. Zod `.optional()` chytá jen `undefined`, ne `""`.
 * Bez tohoto preprocessoru by všechny optional env padaly s "Too small".
 */
function emptyToUndef(schema: z.ZodTypeAny) {
  return z.preprocess(
    (v) => (v === "" ? undefined : v),
    schema,
  );
}

const schema = z.object({
  // ==== Povinné ====
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),

  // ==== Defaulty (vždy mají hodnotu) ====
  APP_URL: emptyToUndef(z.string().url().optional()).pipe(
    z.string().default("http://localhost:3000"),
  ),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  VERTEX_LOCATION: emptyToUndef(z.string().min(2).optional()).pipe(
    z.string().default("europe-west1"),
  ),
  GOOGLE_REDIRECT_URI: emptyToUndef(z.string().url().optional()).pipe(
    z.string().default("https://www.raseliniste.cz/api/integrations/google/callback"),
  ),
  BOOKING_MAGIC_LINK_TTL_HOURS: emptyToUndef(z.coerce.number().int().positive().optional()).pipe(
    z.number().default(24),
  ),

  // ==== Volitelné (můžou být undefined nebo prázdné) ====
  GEMINI_API_KEY: emptyToUndef(z.string().min(10).optional()),
  // Vertex AI (doporučeno pro produkci — EU region, žádné trénování na datech).
  VERTEX_PROJECT: emptyToUndef(z.string().min(1).optional()),
  GOOGLE_APPLICATION_CREDENTIALS: emptyToUndef(z.string().optional()),
  ADMIN_USERNAME: emptyToUndef(z.string().min(2).optional()),
  ADMIN_PASSWORD: emptyToUndef(z.string().min(8).optional()),
  // Email (Resend) — pokud není nastaveno, mailer jen loguje.
  RESEND_API_KEY: emptyToUndef(z.string().min(10).optional()),
  NOTIFICATION_FROM: emptyToUndef(z.string().email().optional()),
  NOTIFICATION_EMAIL: emptyToUndef(z.string().email().optional()),
  // Cron endpoint auth (Synology Task Scheduler posílá v x-cron-key).
  CRON_SECRET: emptyToUndef(z.string().min(16).optional()),
  // Google OAuth (Calendar + People API)
  GOOGLE_CLIENT_ID: emptyToUndef(z.string().min(10).optional()),
  GOOGLE_CLIENT_SECRET: emptyToUndef(z.string().min(10).optional()),
  // Booking magic-link
  BOOKING_MAGIC_LINK_SECRET: emptyToUndef(z.string().min(16).optional()),
  // Siri Shortcut (calendar check)
  SIRI_API_TOKEN: emptyToUndef(z.string().min(16).optional()),
});

type Env = z.infer<typeof schema>;

let cached: Env | null = null;

function load(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/**
 * Lazy environment. Parsing happens on first property access, not at import time —
 * so `astro build` can run without runtime secrets (DATABASE_URL, SESSION_SECRET).
 */
export const env = new Proxy({} as Env, {
  get(_t, prop: string) {
    return load()[prop as keyof Env];
  },
  has(_t, prop: string) {
    return prop in load();
  },
  ownKeys() {
    return Reflect.ownKeys(load());
  },
  getOwnPropertyDescriptor(_t, prop: string) {
    return {
      enumerable: true,
      configurable: true,
      value: load()[prop as keyof Env],
    };
  },
});
