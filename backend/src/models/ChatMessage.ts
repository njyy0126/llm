import { Schema, model, type InferSchemaType, Types } from "mongoose";

const citationSchema = new Schema(
  {
    fileId: { type: String, required: true },
    fileName: { type: String, required: true },
    chunkId: { type: String, required: true },
    chunkIndex: { type: Number, required: true },
    score: { type: Number, required: true },
  },
  { _id: false },
);

const retrievedChunkSchema = new Schema(
  {
    fileId: { type: String, required: true },
    fileName: { type: String, required: true },
    chunkId: { type: String, required: true },
    chunkIndex: { type: Number, required: true },
    score: { type: Number, required: true },
    textPreview: { type: String, required: true },
  },
  { _id: false },
);

const chatMessageSchema = new Schema(
  {
    sessionId: { type: Types.ObjectId, ref: "ChatSession", required: true, index: true },
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true },
    citations: { type: [citationSchema], default: [] },
    retrievedChunks: { type: [retrievedChunkSchema], default: [] },
    status: { type: String, enum: ["completed", "failed"], default: "completed" },
    failureCode: { type: String, enum: ["retrieval", "generation"], required: false },
  },
  { timestamps: true },
);

chatMessageSchema.index({ sessionId: 1, createdAt: 1 });

export type ChatMessageDocument = InferSchemaType<typeof chatMessageSchema>;

export const ChatMessageModel = model("ChatMessage", chatMessageSchema);
