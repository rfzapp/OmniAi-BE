import { z } from "zod";

export const conversationIdParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid conversation id"),
});

export const pinConversationBodySchema = z.object({
  isPinned: z.boolean(),
});

export const renameConversationBodySchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(60, "Title must be 60 characters or fewer"),
});
