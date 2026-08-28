import { z } from "zod";

export const addMemorySchema = z.object({
    content: z.string().trim().min(1, "Memory content cannot be empty").max(1000, "Memory content is too long"),
});

export const memoryParamSchema = z.object({
    id: z.string().min(1, "Memory ID is required"),
});

export type AddMemoryInput = z.infer<typeof addMemorySchema>;
