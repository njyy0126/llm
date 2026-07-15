import { QdrantClient } from "@qdrant/js-client-rest";
import { env } from "../../config/env";

let client: QdrantClient | null = null;
let cachedVectorSize: number | null = null;

type QdrantCollectionClient = {
  getCollection: (collectionName: string) => Promise<{
    config?: { params?: { vectors?: { size: number } | string } };
  }>;
  createCollection: (
    collectionName: string,
    config: { vectors: { size: number; distance: "Cosine" } },
  ) => Promise<unknown>;
};

type EnsureQdrantCollectionDependencies = {
  qdrant?: QdrantCollectionClient;
  collectionName?: string;
};

export const isQdrantCollectionNotFound = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  typeof (error as { status?: unknown }).status === "number" &&
  (error as { status: number }).status === 404;

const getClient = (): QdrantClient => {
  if (!client) {
    client = new QdrantClient({
      url: env.QDRANT_URL,
      apiKey: env.QDRANT_API_KEY,
    });
  }
  return client;
};

export const getQdrantCollectionName = (): string => env.QDRANT_COLLECTION;

export const ensureQdrantCollection = async (
  vectorSize: number,
  dependencies: EnsureQdrantCollectionDependencies = {},
): Promise<void> => {
  const qdrant = dependencies.qdrant ?? (getClient() as unknown as QdrantCollectionClient);
  const collectionName = dependencies.collectionName ?? getQdrantCollectionName();

  if (cachedVectorSize && cachedVectorSize === vectorSize) {
    return;
  }

  try {
    const collection = await qdrant.getCollection(collectionName);
    const config = collection.config?.params?.vectors;
    if (!config || typeof config === "string") {
      throw new Error("Unsupported Qdrant vector config format.");
    }
    const currentSize = config.size;
    if (currentSize !== vectorSize) {
      throw new Error(
        `Qdrant collection dimension mismatch. Existing=${currentSize}, required=${vectorSize}.`,
      );
    }
  } catch (error) {
    if (!isQdrantCollectionNotFound(error)) {
      throw error;
    }
    await qdrant.createCollection(collectionName, {
      vectors: {
        size: vectorSize,
        distance: "Cosine",
      },
    });
  }

  cachedVectorSize = vectorSize;
};

export const getQdrantClient = (): QdrantClient => getClient();

export const resetQdrantCollectionCache = (): void => {
  cachedVectorSize = null;
};
