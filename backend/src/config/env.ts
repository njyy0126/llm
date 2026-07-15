import "dotenv/config";
import { z } from "zod";

const booleanFromString = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }
  return false;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().default("http://localhost:5173"),
  MONGODB_URI: z.string().default("mongodb://127.0.0.1:27017/rag-career-assistant"),
  USE_IN_MEMORY_MONGO: booleanFromString.default(false),
  MAX_FILE_SIZE_MB: z.coerce.number().int().positive().default(5),
  DEFAULT_CHUNK_SIZE: z.coerce.number().int().positive().default(800),
  DEFAULT_CHUNK_OVERLAP: z.coerce.number().int().min(0).default(120),
  EMBEDDING_PROVIDER: z.enum(["qwen", "local"]).default("qwen"),
  DASHSCOPE_API_KEY: z.string().optional(),
  QWEN_EMBEDDING_MODEL: z.string().default("text-embedding-v3"),
  LOCAL_EMBEDDING_DIM: z.coerce.number().int().positive().default(384),
  QDRANT_URL: z.string().default("http://127.0.0.1:6333"),
  QDRANT_API_KEY: z.string().optional(),
  QDRANT_COLLECTION: z.string().default("career_chunks"),
  VECTOR_DB_MODE: z.enum(["qdrant", "mongo"]).default("qdrant"),
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().positive().max(64).default(16),
  QWEN_CHAT_MODEL: z.string().default("qwen-plus"),
  CHAT_MAX_CONTEXT_CHUNKS: z.coerce.number().int().positive().max(12).default(6),
  CHAT_MIN_RELEVANCE_SCORE: z.coerce.number().min(0).max(1).default(0.25),
  CHAT_FALLBACK_TO_EXTRACTIVE: booleanFromString.default(false),
  M5_ANALYSIS_DEFAULT_TOPK: z.coerce.number().int().positive().max(20).default(8),
  JD_REQUIREMENT_EXTRACTION_TIMEOUT_MS: z.coerce.number().int().positive().max(60000).default(15000),
});

export const env = envSchema.parse(process.env);
