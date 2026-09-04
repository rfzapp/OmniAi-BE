import { Router } from "express";
import multer from "multer";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { chatSchema, editImageSchema } from "./ai.validation";
import { chatHandler, chatStreamHandler, editImageHandler } from "./ai.controller";

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

const editUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 2,
  },
  fileFilter: (_req, file, cb) => {
    if (["image/png", "image/jpeg", "image/webp"].includes(file.mimetype) || file.originalname.match(/\.(png|jpg|jpeg|webp)$/i)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported image type: ${file.mimetype || file.originalname}`));
    }
  },
});

const router = Router();

router.use(authMiddleware);
router.post("/chat", upload.array("attachments", 1), validate({ body: chatSchema }), chatHandler);
router.post("/chat/stream", upload.array("attachments", 1), validate({ body: chatSchema }), chatStreamHandler);
router.post(
  "/edit-image",
  editUpload.fields([
    { name: "image", maxCount: 1 },
    { name: "mask", maxCount: 1 },
  ]),
  validate({ body: editImageSchema }),
  editImageHandler
);

export default router;
