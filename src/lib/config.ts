import { z } from "zod";

/**
 * All configuration comes from environment variables, so the app can move
 * between hosts without code changes. See .env.example.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  // Keys hashes of sign-in codes. Long random string; changing it invalidates outstanding codes.
  SECRET_KEY: z.string().min(32, "SECRET_KEY must be at least 32 characters"),
  // Used when the request host matches no verified tenant domain. Never set in production.
  DEV_TENANT_SLUG: z.string().optional(),
  // Read the visitor's address from X-Forwarded-Host. Needed because Next.js renders redirects
  // through an internal hop; safe only when the app listens on 127.0.0.1 behind the web server.
  TRUST_PROXY: z.enum(["true", "false"]).default("true"),
  MAIL_TRANSPORT: z.enum(["console", "smtp"]).default("console"),
  MAIL_FROM: z.string().default("ScopeFlow <no-reply@chayse.com>"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  STORAGE_DIR: z.string().default("./storage"),
  // AI suggestions (slice 6). Without a key the feature is unavailable everywhere.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5-5"),
  ANTHROPIC_VERSION: z.string().default("2026-10-21"),
});

export type Config = z.infer<typeof schema>;

let cached: Config | undefined;

export function config(): Config {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Invalid configuration: ${issues}`);
    }
    if (parsed.data.NODE_ENV === "production" && parsed.data.DEV_TENANT_SLUG) {
      throw new Error("DEV_TENANT_SLUG must not be set in production");
    }
    cached = parsed.data;
  }
  return cached;
}

export const isProduction = () => config().NODE_ENV === "production";
