import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureQdrantCollection,
  isQdrantCollectionNotFound,
  resetQdrantCollectionCache,
} from "./qdrantClient";

test("isQdrantCollectionNotFound accepts only a top-level numeric 404 status", () => {
  assert.equal(isQdrantCollectionNotFound({ status: 404 }), true);
  assert.equal(isQdrantCollectionNotFound({ status: "404" }), false);
  assert.equal(isQdrantCollectionNotFound({ response: { status: 404 } }), false);
  assert.equal(isQdrantCollectionNotFound(new Error("collection not found")), false);
  assert.equal(isQdrantCollectionNotFound(null), false);
  assert.equal(isQdrantCollectionNotFound(undefined), false);
});

test("ensureQdrantCollection creates once when Qdrant reports a top-level 404", async () => {
  resetQdrantCollectionCache();
  let createCalls = 0;
  const qdrant = {
    getCollection: async () => {
      throw { status: 404 };
    },
    createCollection: async () => {
      createCalls += 1;
    },
  };

  await ensureQdrantCollection(384, { qdrant, collectionName: "test-collection" });

  assert.equal(createCalls, 1);
});

for (const error of [
  { status: 500 },
  { response: { status: 404 } },
  new Error("collection not found"),
]) {
  test("ensureQdrantCollection rethrows non-top-level-404 errors without creating", async () => {
    resetQdrantCollectionCache();
    let createCalls = 0;
    const qdrant = {
      getCollection: async () => {
        throw error;
      },
      createCollection: async () => {
        createCalls += 1;
      },
    };

    await assert.rejects(
      () => ensureQdrantCollection(384, { qdrant, collectionName: "test-collection" }),
      (received) => received === error,
    );
    assert.equal(createCalls, 0);
  });
}
