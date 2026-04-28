import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  GEMINI_API_KEY: z.string().min(10).optional(),
  // Vertex AI (doporučeno pro produkci — EU region, žádné trénování na datech).
  // Pokud VERTEX_PROJECT je nastaveno, má přednost před GEMINI_API_KEY.
  VERTEX_PROJECT: z.string().min(1).optional(),
  VERTEX_LOCATION: z.string().min(2).default("europe-west1"),
  // Cesta k service-account JSON (SDK ji čte z GOOGLE_APPLICATION_CREDENTIALS,
  // v env schématu ji jen propagujeme pro validaci existence).
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  APP_URL: z.string().url().default("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  ADMIN_USERNAME: z.string().min(2).optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  // Email (Resend) — pokud není nastaveno, mailer jen loguje.
  RESEND_API_KEY: z.string().min(10).optional(),
  NOTIFICATION_FROM: z.string().email().optional(),
  NOTIFICATION_EMAIL: z.string().email().optional(),
  // Cron endpoint auth (Synology Task Scheduler posílá v x-cron-key).
  CRON_SECRET: z.string().min(16).optional(),
  // Google OAuth (Calendar + People API)
  GOOGLE_CLIENT_ID: z.string().min(10).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(10).optional(),
  GOOGLE_REDIRECT_URI: z.string().url().default("https://www.raseliniste.cz/api/integrations/google/callback"),
  // Booking magic-link
  BOOKING_MAGIC_LINK_SECRET: z.string().min(16).optional(),
  BOOKING_MAGIC_LINK_TTL_HOURS: z.coerce.number().int().positive().default(24),
  // Siri Shortcut (calendar check)
  SIRI_API_TOKEN: z.string().min(16).optional(),
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
 * so `next build` can run without runtime secrets (DATABASE_URL, SESSION_SECRET).
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
