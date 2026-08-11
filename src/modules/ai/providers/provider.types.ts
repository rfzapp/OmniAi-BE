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
  /** apiKeyOverride: when set (BYOK), use the caller's own key instead of the platform's shared one. */
  generateReply(model: string, messages: ProviderChatMessage[], apiKeyOverride?: string): Promise<string>;
}
