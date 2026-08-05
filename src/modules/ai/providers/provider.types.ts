import type { MessageRole } from "../../../types";

export interface ProviderChatMessage {
  role: MessageRole;
  content: string;
}

export interface AIProvider {
  generateReply(model: string, messages: ProviderChatMessage[]): Promise<string>;
}
