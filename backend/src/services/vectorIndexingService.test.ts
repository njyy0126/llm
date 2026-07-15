import test from "node:test";
import assert from "node:assert/strict";
import { clearAllVectorIndexes } from "./vectorIndexingService";

test("clearAllVectorIndexes ignores only a top-level 404 from Qdrant deletion", async () => {
  let clearCalls = 0;
  await clearAllVectorIndexes({
    vectorDbMode: "qdrant",
    collectionName: "test-collection",
    qdrant: { deleteCollection: async () => { throw { status: 404 }; } },
    getExistingIndexCount: async () => 5,
    clearRecords: async () => { clearCalls += 1; },
  });
  assert.equal(clearCalls, 1);
});

test("clearAllVectorIndexes rethrows a top-level 500 from Qdrant deletion", async () => {
  const error = { status: 500 };
  let clearCalls = 0;
  await assert.rejects(
    () => clearAllVectorIndexes({
      vectorDbMode: "qdrant",
      collectionName: "test-collection",
      qdrant: { deleteCollection: async () => { throw error; } },
      getExistingIndexCount: async () => 5,
      clearRecords: async () => { clearCalls += 1; },
    }),
    (received) => received === error,
  );
  assert.equal(clearCalls, 0);
});
