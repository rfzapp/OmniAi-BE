import { Router } from "express";
import multer from "multer";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { chatSchema } from "./ai.validation";
import { chatHandler, chatStreamHandler } from "./ai.controller";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 3 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];

    const extension = file.originalname.toLowerCase();
    const isAllowedExtension =
      extension.endsWith(".pdf") ||
      extension.endsWith(".doc") ||
      extension.endsWith(".docx") ||
      extension.endsWith(".xls") ||
      extension.endsWith(".xlsx") ||
      extension.endsWith(".png") ||
      extension.endsWith(".jpg") ||
      extension.endsWith(".jpeg") ||
      extension.endsWith(".webp") ||
      extension.endsWith(".gif");

    if (allowed.includes(file.mimetype) || isAllowedExtension) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported attachment type: ${file.mimetype || file.originalname}`));
    }
  },
});

const router = Router();

router.use(authMiddleware);
router.post("/chat", upload.array("attachments", 1), validate({ body: chatSchema }), chatHandler);
router.post("/chat/stream", upload.array("attachments", 1), validate({ body: chatSchema }), chatStreamHandler);

export default router;
