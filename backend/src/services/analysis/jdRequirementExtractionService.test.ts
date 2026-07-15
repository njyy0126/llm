import test from "node:test";
import assert from "node:assert/strict";
import {
  createJdRequirementExtractionService,
  createQwenJdRequirementExtractor,
  parseLlmJson,
} from "./jdRequirementExtractionService";

test("returns categorized requirements and preserves an unknown explicit skill", async () => {
  const service = createJdRequirementExtractionService({
    findCached: async () => null,
    save: async (input) => input,
    extractWithLlm: async () => ({
      requiredSkills: [
        {
          name: "Databricks",
          priority: "must_have" as const,
          evidence: "Must have Databricks experience.",
          confidence: 0.96,
        },
      ],
      preferredSkills: [
        {
          name: "Docker",
          priority: "preferred" as const,
          evidence: "Docker experience preferred.",
          confidence: 0.9,
        },
      ],
      niceToHaveSkills: [],
      responsibilitySkills: [],
      experienceRequirements: [],
    }),
    extractWithRules: () => {
      throw new Error("Fallback must not run when LLM output is valid.");
    },
    model: "qwen-plus",
    extractionVersion: 1,
  });

  const result = await service.extract({
    jdFileId: "jd1",
    fullText: "Must have Databricks experience. Docker experience preferred.",
  });

  assert.equal(result.source, "llm");
  assert.equal(result.cached, false);
  assert.equal(result.requiredSkills[0]?.canonicalName, "databricks");
  assert.equal(result.preferredSkills[0]?.canonicalName, "docker");
});

test("returns a cache hit without calling the LLM", async () => {
  let llmCalls = 0;
  const service = createJdRequirementExtractionService({
    findCached: async () => ({
      requiredSkills: [
        {
          name: "TypeScript",
          canonicalName: "typescript",
          priority: "must_have" as const,
          evidence: "TypeScript is required.",
          confidence: 0.98,
        },
      ],
      preferredSkills: [],
      niceToHaveSkills: [],
      responsibilitySkills: [],
      experienceRequirements: [],
      provider: "qwen" as const,
      model: "qwen-plus",
    }),
    save: async (input) => input,
    extractWithLlm: async () => {
      llmCalls += 1;
      throw new Error("The LLM must not run on a cache hit.");
    },
    extractWithRules: () => ({
      requiredSkills: [],
      preferredSkills: [],
      niceToHaveSkills: [],
      responsibilitySkills: [],
      experienceRequirements: [],
    }),
    model: "qwen-plus",
    extractionVersion: 1,
  });

  const result = await service.extract({ jdFileId: "jd1", fullText: "TypeScript is required." });

  assert.equal(result.cached, true);
  assert.equal(llmCalls, 0);
});

test("uses deterministic fallback after malformed LLM output", async () => {
  const service = createJdRequirementExtractionService({
    findCached: async () => null,
    save: async (input) => input,
    extractWithLlm: async () => ({
      requiredSkills: [{ name: "React" }],
    }),
    extractWithRules: () => ({
      requiredSkills: [
        {
          name: "react",
          canonicalName: "react",
          priority: "must_have",
          evidence: "Must have React.",
          confidence: 1,
        },
      ],
      preferredSkills: [],
      niceToHaveSkills: [],
      responsibilitySkills: [],
      experienceRequirements: [],
    }),
    model: "qwen-plus",
    extractionVersion: 1,
  });

  const result = await service.extract({ jdFileId: "jd1", fullText: "Must have React." });

  assert.equal(result.source, "deterministic_fallback");
  assert.equal(result.requiredSkills[0]?.canonicalName, "react");
});

test("uses deterministic fallback when LLM evidence is not present in the JD", async () => {
  const service = createJdRequirementExtractionService({
    findCached: async () => null,
    save: async (input) => input,
    extractWithLlm: async () => ({
      requiredSkills: [
        {
          name: "TypeScript",
          priority: "must_have",
          evidence: "Invented supporting excerpt.",
          confidence: 0.98,
        },
      ],
      preferredSkills: [],
      niceToHaveSkills: [],
      responsibilitySkills: [],
      experienceRequirements: [],
    }),
    extractWithRules: () => ({
      requiredSkills: [],
      preferredSkills: [],
      niceToHaveSkills: [],
      responsibilitySkills: [],
      experienceRequirements: [],
    }),
    model: "qwen-plus",
    extractionVersion: 1,
  });

  const result = await service.extract({
    jdFileId: "jd1",
    fullText: "Must have TypeScript experience.",
  });

  assert.equal(result.source, "deterministic_fallback");
});

test("accepts JSON returned inside a markdown code fence", () => {
  const parsed = parseLlmJson(
    '```json\n{"requiredSkills":[],"preferredSkills":[],"niceToHaveSkills":[],"responsibilitySkills":[],"experienceRequirements":[]}\n```',
  );

  assert.deepEqual(parsed, {
    requiredSkills: [],
    preferredSkills: [],
    niceToHaveSkills: [],
    responsibilitySkills: [],
    experienceRequirements: [],
  });
});

test("sends an evidence-only structured request to Qwen", async () => {
  let requestUrl = "";
  let requestBody: Record<string, unknown> | undefined;
  const extractWithQwen = createQwenJdRequirementExtractor({
    apiKey: "test-key",
    model: "qwen-plus",
    timeoutMs: 5000,
    fetchFn: async (url, init) => {
      requestUrl = String(url);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"requiredSkills":[],"preferredSkills":[],"niceToHaveSkills":[],"responsibilitySkills":[],"experienceRequirements":[]}',
              },
            },
          ],
        }),
        { status: 200 },
      );
    },
  });

  const payload = await extractWithQwen("Must have TypeScript. Docker is a plus.");

  assert.equal(requestUrl.includes("dashscope.aliyuncs.com"), true);
  assert.equal(requestBody?.model, "qwen-plus");
  const messages = requestBody?.messages as Array<{ role: string; content: string }>;
  const systemPrompt = messages.find((message) => message.role === "system")?.content ?? "";
  assert.equal(systemPrompt.includes("Do not infer skills"), true);
  assert.equal(systemPrompt.includes('"priority":"must_have"'), true);
  assert.equal(systemPrompt.includes('"confidence":0.95'), true);
  assert.equal(systemPrompt.includes('"type":"years"'), true);
  assert.deepEqual(payload, {
    requiredSkills: [],
    preferredSkills: [],
    niceToHaveSkills: [],
    responsibilitySkills: [],
    experienceRequirements: [],
  });
});
