import test from "node:test";
import assert from "node:assert/strict";
import * as dashboardController from "./dashboardController";

const createDashboardControllers = (dashboardController as Record<string, unknown>)
  .createDashboardControllers;

test("dashboard controllers forward the same fileType to every dashboard service", async () => {
  assert.equal(typeof createDashboardControllers, "function");
  if (typeof createDashboardControllers !== "function") return;

  const inputs: Array<{ service: string; input: Record<string, string | undefined> }> = [];
  const controllers = createDashboardControllers({
    getDashboardSummary: async (input: Record<string, string | undefined>) => {
      inputs.push({ service: "summary", input });
      return {};
    },
    getMatchTrend: async (input: Record<string, string | undefined>) => {
      inputs.push({ service: "trend", input });
      return {};
    },
    getTopSkillGaps: async (input: Record<string, string | undefined>) => {
      inputs.push({ service: "skill-gaps", input });
      return {};
    },
  });
  const res = {
    status: () => res,
    json: () => res,
  };
  const req = {
    query: {
      days: ["14", "7"],
      fileType: ["resume", "other"],
      limit: ["5", "10"],
    },
  };
  const next = (error: unknown) => {
    throw error;
  };

  await controllers.summary(req as never, res as never, next as never);
  await controllers.matchTrend(req as never, res as never, next as never);
  await controllers.skillGaps(req as never, res as never, next as never);

  assert.deepEqual(inputs, [
    { service: "summary", input: { days: "14", fileType: "resume" } },
    { service: "trend", input: { days: "14", fileType: "resume" } },
    { service: "skill-gaps", input: { limit: "5", fileType: "resume" } },
  ]);
});
