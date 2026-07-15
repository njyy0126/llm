import { z } from "zod";
import { env } from "../config/env";
import { IngestedFileModel } from "../models/IngestedFile";
import { TextChunkModel } from "../models/TextChunk";
import { VectorIndexModel } from "../models/VectorIndex";
import { chunkText } from "./chunker";
import { isSupportedFile, parseFileText } from "./textParser";
import { AppError } from "../utils/AppError";
import {
  getQdrantClient,
  getQdrantCollectionName,
  isQdrantCollectionNotFound,
  resetQdrantCollectionCache,
} from "./vector/qdrantClient";

type QdrantDeletionClient = {
  deleteCollection: (collectionName: string) => Promise<unknown>;
};

type DeleteAllUploadedFilesDependencies = {
  vectorDbMode?: "qdrant" | "mongo";
  qdrant?: QdrantDeletionClient;
  collectionName?: string;
  getCounts?: () => Promise<[number, number, number]>;
  clearRecords?: () => Promise<unknown>;
  resetQdrantCollectionCache?: () => void;
};

const ingestInputSchema = z.object({
  documentType: z.enum(["resume", "job_description", "other"]).default("other"),
  chunkSize: z.coerce.number().int().positive().optional(),
  overlap: z.coerce.number().int().min(0).optional(),
});

export type IngestRequestInput = z.input<typeof ingestInputSchema>;
const listFilesSchema = z.object({
  documentType: z.enum(["resume", "job_description", "other"]).optional(),
  indexedOnly: z.preprocess(
    (value) => {
      if (value === true || value === "true") {
        return true;
      }
      if (value === false || value === "false") {
        return false;
      }
      return value;
    },
    z.boolean().optional(),
  ),
});

export const parseListIngestedFilesInput = (input: {
  documentType?: string;
  indexedOnly?: unknown;
}) => listFilesSchema.parse(input);

export const buildIngestedFilesFilter = (parsed: z.output<typeof listFilesSchema>) => {
  const filter: {
    documentType?: "resume" | "job_description" | "other";
    indexingStatus?: "indexed";
  } = {};

  if (parsed.documentType) {
    filter.documentType = parsed.documentType;
  }
  if (parsed.indexedOnly === true) {
    filter.indexingStatus = "indexed";
  }

  return filter;
};

type IngestionResult = {
  fileId: string;
  chunkCount: number;
  preview: string[];
  file: {
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    totalChars: number;
    documentType: "resume" | "job_description" | "other";
    chunkSize: number;
    overlap: number;
  };
};

export const ingestDocument = async (
  file: Express.Multer.File | undefined,
  input: IngestRequestInput,
): Promise<IngestionResult> => {
  if (!file) {
    throw new AppError("No file uploaded. Use multipart field name `file`.", 400);
  }

  if (!isSupportedFile(file)) {
    throw new AppError("Unsupported file type. Allowed: PDF, TXT, DOCX.", 400);
  }

  const parsedInput = ingestInputSchema.parse(input);
  const chunkSize = parsedInput.chunkSize ?? env.DEFAULT_CHUNK_SIZE;
  const overlap = parsedInput.overlap ?? env.DEFAULT_CHUNK_OVERLAP;

  const { text, extension } = await parseFileText(file);
  const chunks = chunkText(text, chunkSize, overlap);

  if (chunks.length === 0) {
    throw new AppError("No chunks were generated from uploaded text.", 400);
  }

  const ingestedFile = await IngestedFileModel.create({
    originalName: file.originalname,
    mimeType: file.mimetype,
    extension,
    sizeBytes: file.size,
    documentType: parsedInput.documentType,
    totalChars: text.length,
    chunkCount: chunks.length,
    chunkSize,
    overlap,
  });

  await TextChunkModel.insertMany(
    chunks.map((chunk) => ({
      fileId: ingestedFile._id,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      charStart: chunk.charStart,
      charEnd: chunk.charEnd,
    })),
  );

  const preview = chunks.slice(0, 3).map((chunk) => chunk.content.slice(0, 160));

  return {
    fileId: ingestedFile._id.toString(),
    chunkCount: chunks.length,
    preview,
    file: {
      originalName: ingestedFile.originalName,
      mimeType: ingestedFile.mimeType,
      sizeBytes: ingestedFile.sizeBytes,
      totalChars: ingestedFile.totalChars,
      documentType: ingestedFile.documentType,
      chunkSize: ingestedFile.chunkSize,
      overlap: ingestedFile.overlap,
    },
  };
};

export const listIngestedFiles = async (input: { documentType?: string; indexedOnly?: unknown }) => {
  const parsed = parseListIngestedFilesInput(input);
  const filter = buildIngestedFilesFilter(parsed);

  const files = await IngestedFileModel.find(filter).sort({ createdAt: -1 }).limit(100);
  return files.map((file) => ({
    fileId: file._id.toString(),
    originalName: file.originalName,
    documentType: file.documentType,
    indexingStatus: file.indexingStatus,
    chunkCount: file.chunkCount,
    indexedChunkCount: file.indexedChunkCount,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  }));
};

export const deleteAllUploadedFiles = async (
  dependencies: DeleteAllUploadedFilesDependencies = {},
) => {
  const vectorDbMode = dependencies.vectorDbMode ?? env.VECTOR_DB_MODE;
  const getCounts =
    dependencies.getCounts ??
    (() =>
      Promise.all([
        IngestedFileModel.countDocuments(),
        TextChunkModel.countDocuments(),
        VectorIndexModel.countDocuments(),
      ]) as Promise<[number, number, number]>);
  const clearRecords =
    dependencies.clearRecords ??
    (() =>
      Promise.all([
        VectorIndexModel.deleteMany({}),
        TextChunkModel.deleteMany({}),
        IngestedFileModel.deleteMany({}),
      ]));
  const [fileCount, chunkCount, vectorCount] = await getCounts();

  if (vectorDbMode === "qdrant") {
    const qdrant = dependencies.qdrant ?? getQdrantClient();
    const collectionName = dependencies.collectionName ?? getQdrantCollectionName();
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
    deletedFiles: fileCount,
    deletedChunks: chunkCount,
    deletedVectorIndexes: vectorCount,
  };
};
