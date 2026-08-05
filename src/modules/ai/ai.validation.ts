import { z } from "zod";

export const chatSchema = z.object({
  model: z.string().min(1, "model is required"),
  message: z.string().trim().min(1, "message is required").max(8000, "message is too long"),
  conversationId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, "Invalid conversation id")
    .optional(),
});

export type ChatInput = z.infer<typeof chatSchema>;
