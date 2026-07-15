import { Types } from "mongoose";
import { z } from "zod";
import crypto from "node:crypto";
import { env } from "../config/env";
import { IngestedFileModel } from "../models/IngestedFile";
import { TextChunkModel } from "../models/TextChunk";
import { VectorIndexModel } from "../models/VectorIndex";
import { embedTexts } from "./embeddings";
import {
  ensureQdrantCollection,
  getQdrantClient,
  getQdrantCollectionName,
  isQdrantCollectionNotFound,
  resetQdrantCollectionCache,
} from "./vector/qdrantClient";
import { AppError } from "../utils/AppError";

type QdrantDeletionClient = {
  deleteCollection: (collectionName: string) => Promise<unknown>;
};

type ClearAllVectorIndexesDependencies = {
  vectorDbMode?: "qdrant" | "mongo";
  qdrant?: QdrantDeletionClient;
  collectionName?: string;
  getExistingIndexCount?: () => Promise<number>;
  clearRecords?: () => Promise<unknown>;
  resetQdrantCollectionCache?: () => void;
};

const fileIdSchema = z.object({
  fileId: z.string().trim().min(1),
});

const asObjectId = (value: string): Types.ObjectId => {
  if (!Types.ObjectId.isValid(value)) {
    throw new AppError("Invalid fileId format.", 400);
  }
  return new Types.ObjectId(value);
};

const buildStatusFromCounts = (chunkCount: number, indexedCount: number) => {
  if (indexedCount === 0) {
    return "not_started" as const;
  }
  if (indexedCount >= chunkCount) {
    return "indexed" as const;
  }
  return "partial" as const;
};

const toDeterministicUuid = (value: string): string => {
  const hash = crypto.createHash("sha1").update(value).digest("hex");
  const raw = hash.slice(0, 32).split("");
  // Enforce RFC4122 UUID version 5 and variant bits.
  raw[12] = "5";
  raw[16] = ((parseInt(raw[16], 16) & 0x3) | 0x8).toString(16);
  const hex = raw.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

const indexChunksForFile = async (fileId: Types.ObjectId) => {
  const file = await IngestedFileModel.findById(fileId);
  if (!file) {
    throw new AppError("File not found.", 404);
  }

  const allChunks = await TextChunkModel.find({ fileId }).sort({ chunkIndex: 1 });
  if (allChunks.length === 0) {
    throw new AppError("No chunks found for this file. Ingest first.", 400);
  }

  const alreadyIndexed = await VectorIndexModel.find({
    chunkId: { $in: allChunks.map((chunk) => chunk._id) },
  }).select("chunkId");
  const indexedChunkIds = new Set(alreadyIndexed.map((item) => item.chunkId.toString()));
  const pendingChunks = allChunks.filter((chunk) => !indexedChunkIds.has(chunk._id.toString()));

  if (pendingChunks.length === 0) {
    return {
      fileId: file._id.toString(),
      originalName: file.originalName,
      totalChunks: allChunks.length,
      newlyIndexed: 0,
      indexedChunkCount: allChunks.length,
      status: "indexed" as const,
    };
  }

  const qdrant = getQdrantClient();
  const collectionName =
    env.VECTOR_DB_MODE === "qdrant" ? getQdrantCollectionName() : "mongo_vectors";
  let newlyIndexed = 0;
  let embeddingDims = 0;

  for (let i = 0; i < pendingChunks.length; i += env.EMBEDDING_BATCH_SIZE) {
    const batch = pendingChunks.slice(i, i + env.EMBEDDING_BATCH_SIZE);
    const texts = batch.map((chunk) => chunk.content);
    const { vectors, dimensions, provider, model } = await embedTexts(texts);
    embeddingDims = dimensions;

    if (env.VECTOR_DB_MODE === "qdrant") {
      await ensureQdrantCollection(dimensions);

      const points = batch.map((chunk, index) => {
        const pointId = toDeterministicUuid(chunk._id.toString());
        return {
          id: pointId,
          vector: vectors[index],
          payload: {
            fileId: file._id.toString(),
            fileName: file.originalName,
            chunkId: chunk._id.toString(),
            chunkIndex: chunk.chunkIndex,
            textPreview: chunk.content.slice(0, 500),
          },
        };
      });

      await qdrant.upsert(collectionName, {
        wait: true,
        points,
      });
    }

    await VectorIndexModel.bulkWrite(
      batch.map((chunk, index) => ({
        updateOne: {
          filter: { chunkId: chunk._id },
          update: {
            fileId: file._id,
            chunkId: chunk._id,
            chunkIndex: chunk.chunkIndex,
            vectorDb: env.VECTOR_DB_MODE === "qdrant" ? "qdrant" : "mongo",
            collectionName,
            pointId: toDeterministicUuid(chunk._id.toString()),
            embeddingProvider: provider,
            embeddingModel: model,
            embeddingDimensions: dimensions,
            vectorValues: env.VECTOR_DB_MODE === "mongo" ? vectors[index] : undefined,
            indexedAt: new Date(),
          },
          upsert: true,
        },
      })),
    );

    newlyIndexed += batch.length;
    console.log(
      `[indexing] file=${file._id.toString()} progress=${Math.min(i + batch.length, pendingChunks.length)}/${pendingChunks.length}`,
    );
  }

  const indexedCount = allChunks.length;
  file.indexedChunkCount = indexedCount;
  file.indexingStatus = buildStatusFromCounts(file.chunkCount, indexedCount);
  file.lastIndexedAt = new Date();
  await file.save();

  return {
    fileId: file._id.toString(),
    originalName: file.originalName,
    totalChunks: allChunks.length,
    newlyIndexed,
    indexedChunkCount: indexedCount,
    embeddingDimensions: embeddingDims,
    status: file.indexingStatus,
  };
};

export const indexFileVectors = async (input: { fileId: string }) => {
  const parsed = fileIdSchema.parse(input);
  return indexChunksForFile(asObjectId(parsed.fileId));
};

export const indexAllUnindexedFiles = async () => {
  const files = await IngestedFileModel.find({
    $or: [{ indexingStatus: { $ne: "indexed" } }, { indexingStatus: { $exists: false } }],
  }).sort({ createdAt: 1 });

  const results = [];
  for (const file of files) {
    const result = await indexChunksForFile(file._id);
    results.push(result);
  }

  return {
    processedFiles: results.length,
    results,
  };
};

export const getIndexingStatusSummary = async () => {
  const [totalFiles, indexedFiles, partialFiles, totalChunks, indexedChunks] = await Promise.all([
    IngestedFileModel.countDocuments(),
    IngestedFileModel.countDocuments({ indexingStatus: "indexed" }),
    IngestedFileModel.countDocuments({ indexingStatus: "partial" }),
    TextChunkModel.countDocuments(),
    VectorIndexModel.countDocuments(),
  ]);

  return {
    totalFiles,
    indexedFiles,
    partialFiles,
    pendingFiles: Math.max(totalFiles - indexedFiles - partialFiles, 0),
    totalChunks,
    indexedChunks,
    pendingChunks: Math.max(totalChunks - indexedChunks, 0),
    qdrantCollection: env.VECTOR_DB_MODE === "qdrant" ? env.QDRANT_COLLECTION : "mongo_vectors",
    embeddingModel:
      env.EMBEDDING_PROVIDER === "local"
        ? `local-hash-${env.LOCAL_EMBEDDING_DIM}`
        : env.QWEN_EMBEDDING_MODEL,
    vectorDbMode: env.VECTOR_DB_MODE,
  };
};

export const clearAllVectorIndexes = async (
  dependencies: ClearAllVectorIndexesDependencies = {},
) => {
  const vectorDbMode = dependencies.vectorDbMode ?? env.VECTOR_DB_MODE;
  const collectionName =
    dependencies.collectionName ??
    (vectorDbMode === "qdrant" ? getQdrantCollectionName() : "mongo_vectors");
  const getExistingIndexCount =
    dependencies.getExistingIndexCount ?? (() => VectorIndexModel.countDocuments());
  const clearRecords =
    dependencies.clearRecords ??
    (() =>
      Promise.all([
        VectorIndexModel.deleteMany({}),
        IngestedFileModel.updateMany(
          {},
          {
            $set: { indexedChunkCount: 0, indexingStatus: "not_started" },
            $unset: { lastIndexedAt: 1 },
          },
        ),
      ]));
  const existingIndexCount = await getExistingIndexCount();

  if (vectorDbMode === "qdrant") {
    const qdrant = dependencies.qdrant ?? getQdrantClient();
    try {
      await qdrant.deleteCollection(collectionName);
    } catch (error) {
      if (!isQdrantCollectionNotFound(error)) {
        throw error;
      }
    }
    (dependencies.resetQdrantCollectionCache ?? resetQdrantCollectionCache)();
  }

  await clearRecords();

  return {
    clearedIndexRecords: existingIndexCount,
    vectorDbMode,
    collectionName,
  };
};
