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

  // Optional — only required when Claude models are used
  ANTHROPIC_API_KEY: z.string().optional(),

  // Optional — only required when Grok models are used (xAI API key)
  XAI_API_KEY: z.string().optional(),

  // Optional — only required when DeepSeek models are used
  DEEPSEEK_API_KEY: z.string().optional(),

  // Optional — only required when Qwen models are used
  QWEN_API_KEY: z.string().optional(),

  // Optional — only required when Mistral models are used
  MISTRAL_API_KEY: z.string().optional(),

  // Optional — only required when Kimi models are used
  KIMI_API_KEY: z.string().optional(),

  API_KEY_ENCRYPTION_SECRET: z.string().min(16, "API_KEY_ENCRYPTION_SECRET is required (min 16 chars)"),

  FRONTEND_URL: z.string().default("http://localhost:3000"),

  // Email (nodemailer) — required for forgot-password flow
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default("OmniAI <noreply@omniai.app>"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === "production";
