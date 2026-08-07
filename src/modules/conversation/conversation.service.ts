import { ApiError } from "../../utils/ApiError";
import { Conversation } from "./conversation.model";
import { Message } from "../message/message.model";
import { encrypt, decrypt } from "../../utils/encryption";
import type { MessageRole } from "../../types";

const TITLE_MAX_LENGTH = 60;

function buildTitle(firstMessage: string): string {
  const trimmed = firstMessage.trim();
  return trimmed.length > TITLE_MAX_LENGTH ? `${trimmed.slice(0, TITLE_MAX_LENGTH)}…` : trimmed;
}

export async function listConversations(userId: string) {
  return Conversation.find({ userId }).sort({ updatedAt: -1 });
}

export async function getConversationForUser(userId: string, conversationId: string) {
  const conversation = await Conversation.findOne({ _id: conversationId, userId });
  if (!conversation) throw ApiError.notFound("Conversation not found");
  return conversation;
}

export async function listMessages(userId: string, conversationId: string) {
  await getConversationForUser(userId, conversationId);
  const messages = await Message.find({ conversationId }).sort({ createdAt: 1 });
  return messages.map((m) => ({
    ...m.toJSON(),
    content: safeDecrypt(m.content),
  }));
}

export async function findOrCreateConversation(userId: string, model: string, firstMessage: string, conversationId?: string) {
  if (conversationId) {
    return getConversationForUser(userId, conversationId);
  }
  return Conversation.create({ userId, model, title: buildTitle(firstMessage) });
}

export async function appendMessage(conversationId: string, role: MessageRole, content: string, model?: string, imageUrl?: string) {
  return Message.create({
    conversationId,
    role,
    content: encrypt(content),
    ...(model !== undefined && { model }),
    ...(imageUrl !== undefined && { imageUrl }),
  });
}

export async function getRecentMessages(conversationId: string, limit: number) {
  const messages = await Message.find({ conversationId }).sort({ createdAt: -1 }).limit(limit);
  return messages.reverse().map((m) => ({
    ...m.toObject(),
    id: (m as any).id as string,
    role: m.role,
    content: safeDecrypt(m.content),
  }));
}

export async function touchConversation(conversationId: string) {
  await Conversation.findByIdAndUpdate(conversationId, { updatedAt: new Date() });
}

export async function deleteConversation(userId: string, conversationId: string) {
  const conversation = await getConversationForUser(userId, conversationId);
  await Message.deleteMany({ conversationId: conversation.id });
  await conversation.deleteOne();
}

/**
 * Tries to decrypt — if the content is not in encrypted format (e.g. old
 * plain-text messages that predate encryption), returns the raw value so
 * existing chat history still renders correctly.
 */
function safeDecrypt(content: string): string {
  try {
    return decrypt(content);
  } catch {
    return content;
  }
}
