import { z } from "zod";

export const conversationIdParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid conversation id"),
});

export const pinConversationBodySchema = z.object({
  isPinned: z.boolean(),
});
