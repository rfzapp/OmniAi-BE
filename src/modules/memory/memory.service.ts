import { ApiError } from "../../utils/ApiError";
import { User } from "../user/user.model";

export async function listMemories(userId: string) {
    const user = await User.findById(userId).select("memories");
    if (!user) throw ApiError.notFound("User not found");
    return user.toJSON().memories ?? [];
}

export async function addMemory(userId: string, content: string) {
    const createdAt = new Date();
    const user = await User.findByIdAndUpdate(
        userId,
        { $push: { memories: { content, createdAt } } },
        { new: true, runValidators: true },
    ).select("memories");

    if (!user) throw ApiError.notFound("User not found");
    const memories = user.toJSON().memories ?? [];
    const added = memories[memories.length - 1];
    return added;
}

export async function deleteMemory(userId: string, memoryId: string) {
    const user = await User.findByIdAndUpdate(
        userId,
        { $pull: { memories: { _id: memoryId } } },
        { new: true },
    ).select("memories");

    if (!user) throw ApiError.notFound("User not found");
    return user.toJSON().memories ?? [];
}

export async function clearMemories(userId: string) {
    const user = await User.findByIdAndUpdate(
        userId,
        { $set: { memories: [] } },
        { new: true },
    ).select("memories");

    if (!user) throw ApiError.notFound("User not found");
    return [];
}
