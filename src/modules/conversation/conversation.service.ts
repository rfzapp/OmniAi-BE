import crypto from "crypto";
import { ApiError } from "../../utils/ApiError";
import { Conversation } from "./conversation.model";
import { Message } from "../message/message.model";
import { encrypt, decrypt } from "../../utils/encryption";
import type { MessageRole } from "../../types";

const TITLE_MAX_LENGTH = 60;

function buildTitle(firstMessage: string): string {
  const trimmed = firstMessage.trim();
  if (!trimmed) return "Attachment chat";
  return trimmed.length > TITLE_MAX_LENGTH ? `${trimmed.slice(0, TITLE_MAX_LENGTH)}…` : trimmed;
}

export async function listConversations(userId: string) {
  return Conversation.find({ userId }).sort({ isPinned: -1, updatedAt: -1 });
}

export async function getConversationForUser(userId: string, conversationId: string) {
  const conversation = await Conversation.findOne({ _id: conversationId, userId });
  if (!conversation) throw ApiError.notFound("Conversation not found");
  return conversation;
}

export async function listMessages(userId: string, conversationId: string) {
  // Run ownership check and message fetch in parallel — both are reads
  const [, messages] = await Promise.all([
    getConversationForUser(userId, conversationId),
    Message.find({ conversationId }, { role: 1, content: 1, model: 1, imageUrl: 1, createdAt: 1 }).sort({ createdAt: 1 }),
  ]);
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
  const messages = await Message.find(
    { conversationId },
    { role: 1, content: 1, model: 1, imageUrl: 1, createdAt: 1 },
  ).sort({ createdAt: -1 }).limit(limit);
  return messages.reverse().map((m) => ({
    ...m.toObject(),
    id: (m as any).id as string,
    role: m.role,
    content: safeDecrypt(m.content),
  }));
}

export function touchConversation(conversationId: string): void {
  // Fire-and-forget — nothing in the response path depends on this timestamp.
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  Conversation.findByIdAndUpdate(conversationId, { updatedAt: new Date() });
}

export async function deleteConversation(userId: string, conversationId: string) {
  const conversation = await getConversationForUser(userId, conversationId);
  await Message.deleteMany({ conversationId: conversation.id });
  await conversation.deleteOne();
}

export async function pinConversation(userId: string, conversationId: string, isPinned: boolean) {
  const conversation = await getConversationForUser(userId, conversationId);
  conversation.isPinned = isPinned;
  await conversation.save();
  return conversation;
}

export async function shareConversation(userId: string, conversationId: string) {
  const conversation = await getConversationForUser(userId, conversationId);
  if (conversation.shareToken) return conversation; // already shared
  const token = crypto.randomBytes(24).toString("hex");
  conversation.shareToken = token;
  await conversation.save();
  return conversation;
}

export async function unshareConversation(userId: string, conversationId: string) {
  const conversation = await getConversationForUser(userId, conversationId);
  conversation.shareToken = null;
  await conversation.save();
  return conversation;
}

export async function getSharedConversation(shareToken: string) {
  const conversation = await Conversation.findOne({ shareToken });
  if (!conversation) throw ApiError.notFound("Shared conversation not found");
  return conversation;
}

export async function getSharedMessages(shareToken: string) {
  const conversation = await getSharedConversation(shareToken);
  const messages = await Message.find({ conversationId: conversation.id }).sort({ createdAt: 1 });
  return {
    conversation,
    messages: messages.map((m) => ({ ...m.toJSON(), content: safeDecrypt(m.content) })),
  };
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
