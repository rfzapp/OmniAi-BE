import { Schema, model, type InferSchemaType, type Types } from "mongoose";

const conversationSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      default: "New Conversation",
    },
    model: {
      type: String,
      required: true,
    },
    shareToken: {
      type: String,
      default: null,
      index: { sparse: true },
    },
    isPinned: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

// Mongoose's `id` virtual (string form of `_id`) isn't included in JSON
// output by default — without this, every conversation would serialize
// with `_id` only, leaving the frontend's `id` field undefined.
conversationSchema.set("toJSON", {
  virtuals: true,
  transform: (_doc, ret) => {
    delete (ret as { _id?: unknown })._id;
    delete (ret as { __v?: number }).__v;
    return ret;
  },
});

export type ConversationDoc = InferSchemaType<typeof conversationSchema> & { _id: Types.ObjectId };

export const Conversation = model("Conversation", conversationSchema);
