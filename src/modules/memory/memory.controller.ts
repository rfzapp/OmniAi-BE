import type { Request, Response } from "express";
import { sendSuccess } from "../../utils/ApiResponse";
import { ApiError } from "../../utils/ApiError";
import * as memoryService from "./memory.service";

export async function listMemoriesHandler(req: Request, res: Response) {
    if (!req.user) throw ApiError.unauthorized();
    const memories = await memoryService.listMemories(req.user.id);
    sendSuccess(res, 200, "Memories fetched successfully", { memories });
}

export async function addMemoryHandler(req: Request, res: Response) {
    if (!req.user) throw ApiError.unauthorized();
    const { content } = req.body as { content: string };
    const memory = await memoryService.addMemory(req.user.id, content);
    sendSuccess(res, 201, "Memory added successfully", { memory });
}

export async function deleteMemoryHandler(req: Request, res: Response) {
    if (!req.user) throw ApiError.unauthorized();
    const memoryId = req.params["id"] as string;
    const memories = await memoryService.deleteMemory(req.user.id, memoryId);
    sendSuccess(res, 200, "Memory deleted successfully", { memories });
}

export async function clearMemoriesHandler(req: Request, res: Response) {
    if (!req.user) throw ApiError.unauthorized();
    await memoryService.clearMemories(req.user.id);
    sendSuccess(res, 200, "All memories cleared successfully", { memories: [] });
}
