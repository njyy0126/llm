import test from "node:test";
import assert from "node:assert/strict";
import { JdRequirementExtractionModel } from "./JdRequirementExtraction";

test("indexes JD extraction cache records by file, content hash, and schema version", () => {
  const hasCacheIndex = JdRequirementExtractionModel.schema.indexes().some(([fields, options]) =>
    fields.jdFileId === 1 &&
    fields.contentHash === 1 &&
    fields.extractionVersion === 1 &&
    options.unique === true,
  );

  assert.equal(hasCacheIndex, true);
});
