import dotenv from "dotenv";
import { z } from "zod";

// override: true because dotenv otherwise never overwrites a variable that's
// already set in the shell/system environment (e.g. a global OPENAI_API_KEY
// left over from some other tool) — for this app, .env must always win.
dotenv.config({ override: true });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(5000),

  MONGO_URI: z.string().min(1, "MONGO_URI is required"),

  JWT_ACCESS_SECRET: z.string().min(1, "JWT_ACCESS_SECRET is required"),
  JWT_ACCESS_EXPIRES_IN: z.string().default("7d"),
  JWT_REFRESH_SECRET: z.string().min(1, "JWT_REFRESH_SECRET is required"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),

  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),

  API_KEY_ENCRYPTION_SECRET: z.string().min(16, "API_KEY_ENCRYPTION_SECRET is required (min 16 chars)"),

  FRONTEND_URL: z.string().default("http://localhost:3000"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
