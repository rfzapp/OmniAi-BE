import Anthropic from "@anthropic-ai/sdk";
import { env } from "./env";

export const anthropicClient = env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  : null;

/** Returns a client scoped to a BYOK key when provided, otherwise the shared platform client. */
export function getAnthropicClient(apiKeyOverride?: string): Anthropic {
  if (apiKeyOverride) return new Anthropic({ apiKey: apiKeyOverride });
  if (anthropicClient) return anthropicClient;
  throw new Error("ANTHROPIC_API_KEY is not configured. Add it to your environment variables.");
}
