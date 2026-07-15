import test from "node:test";
import assert from "node:assert/strict";
import {
  buildIngestedFilesFilter,
  deleteAllUploadedFiles,
  parseListIngestedFilesInput,
} from "./ingestionService";

test("parseListIngestedFilesInput parses boolean indexedOnly values exactly", () => {
  assert.equal(parseListIngestedFilesInput({ indexedOnly: true }).indexedOnly, true);
  assert.equal(parseListIngestedFilesInput({ indexedOnly: false }).indexedOnly, false);
  assert.equal(parseListIngestedFilesInput({ indexedOnly: "true" }).indexedOnly, true);
  assert.equal(parseListIngestedFilesInput({ indexedOnly: "false" }).indexedOnly, false);
});

test("parseListIngestedFilesInput rejects non-boolean indexedOnly values", () => {
  assert.throws(() => parseListIngestedFilesInput({ indexedOnly: "0" }));
});

test("buildIngestedFilesFilter constrains indexing status only for indexedOnly true", () => {
  assert.deepEqual(buildIngestedFilesFilter(parseListIngestedFilesInput({ indexedOnly: "false" })), {});
  assert.deepEqual(buildIngestedFilesFilter(parseListIngestedFilesInput({ indexedOnly: true })), {
    indexingStatus: "indexed",
  });
});

test("deleteAllUploadedFiles ignores only a top-level 404 from Qdrant deletion", async () => {
  let clearCalls = 0;
  await deleteAllUploadedFiles({
    vectorDbMode: "qdrant",
    collectionName: "test-collection",
    qdrant: { deleteCollection: async () => { throw { status: 404 }; } },
    getCounts: async () => [2, 3, 4],
    clearRecords: async () => { clearCalls += 1; },
  });
  assert.equal(clearCalls, 1);
});

test("deleteAllUploadedFiles rethrows a top-level 500 from Qdrant deletion", async () => {
  const error = { status: 500 };
  let clearCalls = 0;
  await assert.rejects(
    () => deleteAllUploadedFiles({
      vectorDbMode: "qdrant",
      collectionName: "test-collection",
      qdrant: { deleteCollection: async () => { throw error; } },
      getCounts: async () => [2, 3, 4],
      clearRecords: async () => { clearCalls += 1; },
    }),
    (received) => received === error,
  );
  assert.equal(clearCalls, 0);
});
