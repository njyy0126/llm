import test from "node:test";
import assert from "node:assert/strict";
import { MatchAnalysisModel } from "./MatchAnalysis";

test("persists JD extraction provenance and non-mandatory qualification groups", () => {
  assert.ok(MatchAnalysisModel.schema.path("preferredSkills"));
  assert.ok(MatchAnalysisModel.schema.path("niceToHaveSkills"));
  assert.ok(MatchAnalysisModel.schema.path("requirementExtraction"));
});
