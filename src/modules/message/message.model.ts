import { Schema, model, type InferSchemaType } from "mongoose";

const messageSchema = new Schema(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ["user", "assistant", "system"],
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    model: {
      type: String,
    },
    imageUrl: {
      type: String,
    },
    // Persistent Cloudinary URL for non-image file attachments (PDF, DOCX, XLSX, etc.).
    // Stored separately from imageUrl so generated images and document attachments
    // don't share the same field and can be distinguished on the frontend.
    attachmentUrl: {
      type: String,
    },
    // Original file name of the attachment, stored so the FE can display it
    // without needing to parse the Cloudinary URL.
    attachmentName: {
      type: String,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Compound index covers both query patterns:
// 1. Message.find({ conversationId }).sort({ createdAt: 1 })  — full history
// 2. Message.find({ conversationId }).sort({ createdAt: -1 }).limit(N) — recent context
messageSchema.index({ conversationId: 1, createdAt: 1 });

messageSchema.set("toJSON", {
  virtuals: true,
  transform: (_doc, ret) => {
    delete (ret as { _id?: unknown })._id;
    delete (ret as { __v?: number }).__v;
    return ret;
  },
});

export type MessageDoc = InferSchemaType<typeof messageSchema>;

export const Message = model("Message", messageSchema);
