import test from "node:test";
import assert from "node:assert/strict";
import {
  createMatchAnalysisService,
  type MatchAnalysisDependencies,
} from "./matchAnalysisService";
import type { RetrievedChunk } from "../retrievalService";

const resumeFileId = "507f1f77bcf86cd799439011";
const jdFileId = "507f1f77bcf86cd799439012";

type TestFile = Awaited<ReturnType<MatchAnalysisDependencies["findFileById"]>>;

const readyFile = (
  id: string,
  documentType: "resume" | "job_description" | "other",
  overrides: Partial<NonNullable<TestFile>> = {},
) => ({
  id,
  originalName: `${documentType}.txt`,
  documentType,
  indexingStatus: "indexed" as const,
  chunkCount: 2,
  indexedChunkCount: 2,
  ...overrides,
});

const retrievedChunk = (
  fileId: string,
  chunkId: string,
  score: number,
  textPreview: string,
): RetrievedChunk => ({
  fileId,
  fileName: fileId === resumeFileId ? "resume.txt" : "jd.txt",
  chunkId,
  chunkIndex: 0,
  score,
  textPreview,
});

const buildDependencies = (options: {
  files?: Map<string, NonNullable<TestFile>>;
  vectorCounts?: Map<string, number>;
  retrieve?: MatchAnalysisDependencies["retrieveSimilarChunks"];
  loadAllChunkText?: MatchAnalysisDependencies["loadAllChunkText"];
  resolveJdRequirements?: MatchAnalysisDependencies["resolveJdRequirements"];
} = {}) => {
  let createCalls = 0;
  let retrievalCalls = 0;
  const dependencies: MatchAnalysisDependencies = {
    findFileById: async (fileId) => options.files?.get(fileId) ?? null,
    countVectorIndexRecords: async (fileId) => options.vectorCounts?.get(fileId) ?? 2,
    loadAllChunkText: options.loadAllChunkText ?? (async () => "Fallback test JD text."),
    retrieveSimilarChunks: async (input) => {
      retrievalCalls += 1;
      return (
        (await options.retrieve?.(input)) ?? {
          query: input.query,
          topK: typeof input.topK === "number" ? input.topK : 8,
          fileId: input.fileId ?? null,
          fileIds: input.fileId ? [input.fileId] : [],
          results: [],
        }
      );
    },
    createAnalysis: async (analysis) => {
      createCalls += 1;
      return {
        analysisId: "507f1f77bcf86cd799439013",
        ...analysis,
        createdAt: new Date("2026-07-14T00:00:00.000Z"),
      };
    },
    resolveJdRequirements:
      options.resolveJdRequirements ??
      (async () => ({
        requiredSkills: [],
        preferredSkills: [],
        niceToHaveSkills: [],
        responsibilitySkills: [],
        experienceRequirements: [],
        provider: "qwen" as const,
        model: "qwen-plus",
        source: "deterministic_fallback" as const,
        cached: false,
      })),
  };
  return {
    run: createMatchAnalysisService(dependencies),
    createCalls: () => createCalls,
    retrievalCalls: () => retrievalCalls,
  };
};

test("rejects files with the wrong resume/JD document types before retrieval", async (t) => {
  for (const [name, resumeType, jdType] of [
    ["resume is not a resume", "job_description", "job_description"],
    ["JD is not a job description", "resume", "resume"],
  ] as const) {
    await t.test(name, async () => {
      const files = new Map<string, NonNullable<TestFile>>([
        [resumeFileId, readyFile(resumeFileId, resumeType)],
        [jdFileId, readyFile(jdFileId, jdType)],
      ]);
      const service = buildDependencies({ files });

      await assert.rejects(
        () => service.run({ resumeFileId, jdFileId }),
        (error: unknown) =>
          error instanceof Error && "statusCode" in error && error.statusCode === 400,
      );
      assert.equal(service.retrievalCalls(), 0);
      assert.equal(service.createCalls(), 0);
    });
  }
});

test("rejects not-started, incomplete, and vector-mismatched files before retrieval", async (t) => {
  const cases = [
    {
      name: "not started",
      file: readyFile(resumeFileId, "resume", {
        indexingStatus: "not_started",
        indexedChunkCount: 0,
      }),
      vectorCount: 0,
    },
    {
      name: "incomplete counters",
      file: readyFile(resumeFileId, "resume", { indexedChunkCount: 1 }),
      vectorCount: 1,
    },
    {
      name: "vector count mismatch",
      file: readyFile(resumeFileId, "resume"),
      vectorCount: 1,
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const files = new Map<string, NonNullable<TestFile>>([
        [resumeFileId, item.file],
        [jdFileId, readyFile(jdFileId, "job_description")],
      ]);
      const vectorCounts = new Map([
        [resumeFileId, item.vectorCount],
        [jdFileId, 2],
      ]);
      const service = buildDependencies({ files, vectorCounts });

      await assert.rejects(
        () => service.run({ resumeFileId, jdFileId }),
        (error: unknown) =>
          error instanceof Error && "statusCode" in error && error.statusCode === 400,
      );
      assert.equal(service.retrievalCalls(), 0);
      assert.equal(service.createCalls(), 0);
    });
  }
});

test("rejects when ready files have no real scoped retrieval evidence", async () => {
  const files = new Map<string, NonNullable<TestFile>>([
    [resumeFileId, readyFile(resumeFileId, "resume")],
    [jdFileId, readyFile(jdFileId, "job_description")],
  ]);
  const service = buildDependencies({ files });

  await assert.rejects(
    () => service.run({ resumeFileId, jdFileId }),
    (error: unknown) =>
      error instanceof Error && "statusCode" in error && error.statusCode === 400,
  );
  assert.equal(service.retrievalCalls(), 6);
  assert.equal(service.createCalls(), 0);
});

test("uses only deduplicated scoped retrieval results and preserves their real scores", async () => {
  const files = new Map<string, NonNullable<TestFile>>([
    [resumeFileId, readyFile(resumeFileId, "resume")],
    [jdFileId, readyFile(jdFileId, "job_description")],
  ]);
  const service = buildDependencies({
    files,
    retrieve: async ({ fileId, query, topK }) => ({
      query,
      topK: typeof topK === "number" ? topK : 8,
      fileId: fileId ?? null,
      fileIds: fileId ? [fileId] : [],
      results:
        fileId === resumeFileId
          ? [
              retrievedChunk(resumeFileId, "resume-chunk", 0.42, "Built Node.js services."),
              retrievedChunk(resumeFileId, "resume-chunk", 0.91, "Built Node.js services."),
            ]
          : [retrievedChunk(jdFileId, "jd-chunk", 0.83, "Requirements: Node.js is required.")],
    }),
  });

  const result = await service.run({ resumeFileId, jdFileId });

  assert.equal(service.createCalls(), 1);
  assert.deepEqual(result.evidenceSummary, [
    {
      fileId: resumeFileId,
      fileName: "resume.txt",
      chunkId: "resume-chunk",
      chunkIndex: 0,
      score: 0.91,
    },
    {
      fileId: jdFileId,
      fileName: "jd.txt",
      chunkId: "jd-chunk",
      chunkIndex: 0,
      score: 0.83,
    },
  ]);
  assert.equal(result.evidenceSummary.some((item) => item.score === 0.12), false);
});

test("scores only must-have skills when JD extraction classifies preferred skills separately", async () => {
  const files = new Map<string, NonNullable<TestFile>>([
    [resumeFileId, readyFile(resumeFileId, "resume")],
    [jdFileId, readyFile(jdFileId, "job_description")],
  ]);
  const service = buildDependencies({
    files,
    retrieve: async ({ fileId, query, topK }) => ({
      query,
      topK: typeof topK === "number" ? topK : 8,
      fileId: fileId ?? null,
      fileIds: fileId ? [fileId] : [],
      results:
        fileId === resumeFileId
          ? [retrievedChunk(resumeFileId, "resume-typescript", 0.9, "Built TypeScript services.")]
          : [
              retrievedChunk(
                jdFileId,
                "jd-requirements",
                0.85,
                "Requirements:\nTypeScript is required.\nDocker is preferred.",
              ),
            ],
    }),
    resolveJdRequirements: async () => ({
      source: "llm",
      cached: false,
      provider: "qwen",
      model: "qwen-plus",
      requiredSkills: [
        {
          name: "TypeScript",
          canonicalName: "typescript",
          priority: "must_have",
          evidence: "TypeScript is required.",
          confidence: 0.99,
        },
      ],
      preferredSkills: [
        {
          name: "Docker",
          canonicalName: "docker",
          priority: "preferred",
          evidence: "Docker is preferred.",
          confidence: 0.95,
        },
      ],
      niceToHaveSkills: [],
      responsibilitySkills: [],
      experienceRequirements: [],
    }),
  });

  const result = await service.run({ resumeFileId, jdFileId });

  assert.equal(result.scoringMeta.requiredSkillCount, 1);
  assert.equal(result.missingSkills.some((item) => item.skill === "docker"), false);
  assert.equal(
    (result as unknown as { preferredSkills: Array<{ skill: string }> }).preferredSkills[0]?.skill,
    "docker",
  );
});
