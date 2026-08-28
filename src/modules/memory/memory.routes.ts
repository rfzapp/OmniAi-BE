import { Router } from "express";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { addMemorySchema, memoryParamSchema } from "./memory.validation";
import {
    addMemoryHandler,
    clearMemoriesHandler,
    deleteMemoryHandler,
    listMemoriesHandler,
} from "./memory.controller";

const router = Router();

router.use(authMiddleware);

router.get("/", listMemoriesHandler);
router.post("/", validate({ body: addMemorySchema }), addMemoryHandler);
router.delete("/", clearMemoriesHandler);
router.delete("/:id", validate({ params: memoryParamSchema }), deleteMemoryHandler);

export default router;
