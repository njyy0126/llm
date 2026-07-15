import test from "node:test";
import assert from "node:assert/strict";
import * as dashboardService from "./dashboardService";

const buildDashboardFilters = (dashboardService as Record<string, unknown>).buildDashboardFilters;

test("aggregateSkillGapsFromAnalyses counts and sorts missing skills", () => {
  const result = dashboardService.aggregateSkillGapsFromAnalyses([
    {
      missingSkills: [{ skill: "NodeJS" }, { skill: "Docker" }],
    },
    {
      missingSkills: [{ skill: "nodejs" }, { skill: "TypeScript" }],
    },
    {
      missingSkills: [{ skill: "docker" }],
    },
  ]);

  assert.deepEqual(result, [
    { skill: "docker", frequency: 2 },
    { skill: "nodejs", frequency: 2 },
    { skill: "typescript", frequency: 1 },
  ]);
});

test("buildDashboardFilters scopes resume files and analyses by resumeFileId", () => {
  assert.equal(typeof buildDashboardFilters, "function");
  if (typeof buildDashboardFilters !== "function") return;

  assert.deepEqual(buildDashboardFilters("resume", ["resume-1", "resume-2"]), {
    fileFilter: { documentType: "resume" },
    analysisFilter: { resumeFileId: { $in: ["resume-1", "resume-2"] } },
  });
});

test("buildDashboardFilters scopes job descriptions and analyses by jdFileId", () => {
  assert.equal(typeof buildDashboardFilters, "function");
  if (typeof buildDashboardFilters !== "function") return;

  assert.deepEqual(buildDashboardFilters("job_description", ["jd-1"]), {
    fileFilter: { documentType: "job_description" },
    analysisFilter: { jdFileId: { $in: ["jd-1"] } },
  });
});

test("buildDashboardFilters excludes analyses for other files", () => {
  assert.equal(typeof buildDashboardFilters, "function");
  if (typeof buildDashboardFilters !== "function") return;

  assert.deepEqual(buildDashboardFilters("other", ["other-1"]), {
    fileFilter: { documentType: "other" },
    analysisFilter: { _id: { $in: [] } },
  });
});
