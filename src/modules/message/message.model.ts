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
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

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
