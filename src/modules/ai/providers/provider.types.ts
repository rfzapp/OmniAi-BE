import type { MessageRole } from "../../../types";

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

export interface AIProvider {
  /** Returns the full response text (non-streaming fallback). */
  generateReply(model: string, messages: ProviderChatMessage[], apiKeyOverride?: string): Promise<string>;
  /** Streams tokens via async generator. Each yielded string is a token chunk. */
  generateStream(model: string, messages: ProviderChatMessage[], apiKeyOverride?: string): AsyncGenerator<string>;
}
