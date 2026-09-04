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

export async function listConversations(userId: string, limit = 50, skip = 0) {
  const conversations = await Conversation.find({ userId })
    .select("title model isPinned createdAt updatedAt")
    .sort({ isPinned: -1, updatedAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return conversations.map((c: any) => ({
    id: c._id.toString(),
    title: c.title,
    model: c.model,
    isPinned: Boolean(c.isPinned),
    createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: c.updatedAt ? new Date(c.updatedAt).toISOString() : new Date().toISOString(),
  }));
}

export async function getConversationForUser(userId: string, conversationId: string) {
  const conversation = await Conversation.findOne({ _id: conversationId, userId });
  if (!conversation) throw ApiError.notFound("Conversation not found");
  return conversation;
}

export async function listMessages(userId: string, conversationId: string, limit = 100, before?: string) {
  const query: Record<string, any> = { conversationId };
  if (before) {
    query.createdAt = { $lt: new Date(before) };
  }

  // Run ownership check and message fetch in parallel
  const [, messages] = await Promise.all([
    getConversationForUser(userId, conversationId),
    Message.find(
      query,
      { role: 1, content: 1, model: 1, imageUrl: 1, originalImageUrl: 1, attachmentUrl: 1, attachmentName: 1, createdAt: 1 }
    )
      .sort({ createdAt: before ? -1 : 1 })
      .limit(limit)
      .lean(),
  ]);

  const sorted = before ? (messages as any[]).reverse() : messages;

  return (sorted as any[]).map((m) => ({
    id: m._id.toString(),
    conversationId: m.conversationId?.toString() || conversationId,
    role: m.role,
    content: safeDecrypt(m.content),
    model: m.model,
    imageUrl: m.imageUrl || null,
    originalImageUrl: m.originalImageUrl || null,
    createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : new Date().toISOString(),
  }));
}

export async function findOrCreateConversation(userId: string, model: string, firstMessage: string, conversationId?: string) {
  if (conversationId) {
    return getConversationForUser(userId, conversationId);
  }
  return Conversation.create({ userId, model, title: buildTitle(firstMessage) });
}

export async function appendMessage(
  conversationId: string,
  role: MessageRole,
  content: string,
  model?: string,
  imageUrl?: string,
  attachmentUrl?: string,
  attachmentName?: string,
) {
  return Message.create({
    conversationId,
    role,
    content: encrypt(content),
    ...(model !== undefined && { model }),
    ...(imageUrl !== undefined && { imageUrl }),
    ...(attachmentUrl !== undefined && { attachmentUrl }),
    ...(attachmentName !== undefined && { attachmentName }),
  });
}

export async function getRecentMessages(conversationId: string, limit: number) {
  const messages = await Message.find(
    { conversationId },
    { role: 1, content: 1, model: 1, imageUrl: 1, attachmentUrl: 1, attachmentName: 1, createdAt: 1 },
    { role: 1, content: 1, model: 1, imageUrl: 1, originalImageUrl: 1, createdAt: 1 },
  ).sort({ createdAt: -1 }).limit(limit);
  return messages.reverse().map((m) => ({
    id: (m as any).id as string,
    role: m.role,
    content: safeDecrypt(m.content),
  }));
}

export async function touchConversation(conversationId: string): Promise<void> {
  // Awaited to ensure the DB write completes before the response is sent.
  // Using updateOne with strict:false and timestamps:false to bypass Mongoose's
  // timestamp intercept which silently ignores manual updatedAt writes.
  await Conversation.collection.updateOne(
    { _id: new (require("mongoose").Types.ObjectId)(conversationId) },
    { $set: { updatedAt: new Date() } },
  );
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
 *
 * If decryption fails AND the value looks like an AES-GCM payload
 * (two hex segments separated by colons), it means the message was stored
 * as encrypted content that can no longer be read (e.g. after a key change,
 * or a previously-empty message that was mistakenly persisted). In that case
 * we return a safe fallback rather than leaking the internal payload format.
 */
function safeDecrypt(content: string): string {
  try {
    return decrypt(content);
  } catch {
    // AES-256-GCM payloads look like "ivHex:authTagHex:ciphertextHex".
    // If decryption fails on something matching that pattern, the original
    // plaintext is unrecoverable — return a neutral fallback instead of the
    // raw encrypted string.
    if (/^[0-9a-f]{24}:[0-9a-f]{32}:/i.test(content)) {
      return "";
    }
    // Otherwise it's a legacy plain-text message — return as-is.
    return content;
  }
}
