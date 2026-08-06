import type { MessageRole } from "../../../types";

export interface ProviderChatMessage {
  role: MessageRole;
  content: string;
}

export interface AIProvider {
  /** apiKeyOverride: when set (BYOK), use the caller's own key instead of the platform's shared one. */
  generateReply(model: string, messages: ProviderChatMessage[], apiKeyOverride?: string): Promise<string>;
}
