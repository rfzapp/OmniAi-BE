import type { MessageRole } from "../../../types";
import type { BillableUsage } from "../../billing/pricing";

export interface ProviderContentTextPart {
  type: "text";
  text: string;
}

export interface ProviderContentImagePart {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
}

export type ProviderContentPart = ProviderContentTextPart | ProviderContentImagePart;

export interface ProviderChatMessage {
  role: MessageRole;
  content: string | ProviderContentPart[];
}

export interface AIStreamChunk {
  type: "start" | "token" | "usage" | "done" | "error";
  content?: string;
  metadata?: unknown;
  usage?: BillableUsage;
}

export interface ProviderResponse {
  text: string;
  usage?: BillableUsage | undefined;
}

export interface AIProvider {
  /** Returns the full response text and provider-reported usage. */
  generateReply(model: string, messages: ProviderChatMessage[], apiKeyOverride?: string): Promise<ProviderResponse>;
  /** Streams normalized tokens via async generator. */
  generateStream(model: string, messages: ProviderChatMessage[], apiKeyOverride?: string, signal?: AbortSignal): AsyncGenerator<AIStreamChunk>;
}
