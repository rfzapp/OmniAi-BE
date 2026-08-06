import OpenAI from "openai";
import { env } from "./env";

export const openaiClient = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
});

/** Returns a client scoped to a BYOK key when provided, otherwise the shared platform client. */
export function getOpenAIClient(apiKeyOverride?: string): OpenAI {
  return apiKeyOverride ? new OpenAI({ apiKey: apiKeyOverride }) : openaiClient;
}
