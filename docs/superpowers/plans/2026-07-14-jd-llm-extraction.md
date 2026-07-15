# LLM-First JD Requirement Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Make Qwen-based, evidence-backed JD requirement extraction the primary source for match analysis while retaining the deterministic extractor as an explicit failure-only fallback.

**Architecture:** Add a focused requirement-extraction service and persistent cache model. The service accepts full JD text, validates a strict Qwen JSON response, normalizes labels, and returns categorized requirements. Match analysis consumes only must_have skills for its reproducible score and exposes other priorities as informative groups. The existing keyword extractor remains isolated behind a fallback adapter.

**Tech Stack:** Node.js, TypeScript, Express, Mongoose, Zod, Node test runner via tsx, React, Vite.

---

## File Structure

- Create backend/src/models/JdRequirementExtraction.ts: Mongoose cache record and typed persisted extraction shape.
- Create backend/src/services/analysis/jdRequirementExtractionService.ts: Qwen request, JSON extraction, Zod validation, normalization, cache lookup/write, and deterministic fallback orchestration.
- Create backend/src/services/analysis/jdRequirementExtractionService.test.ts: service-level red/green tests with injected persistence and LLM adapters.
- Modify backend/src/services/analysis/skillExtractor.ts: export normalization and a deterministic categorized fallback without changing its resume-evidence behavior.
- Modify backend/src/services/analysis/matchAnalysisService.ts: load full JD chunk text, resolve cached/LLM/fallback requirements, score only mandatory skills, and return categorised results/provenance.
- Modify backend/src/services/analysis/matchAnalysisService.test.ts: prove mandatory-only scoring and returned requirement groups.
- Modify backend/src/config/env.ts and .env.example: add bounded extraction timeout/configuration defaults.
- Modify frontend/src/components/MatchAnalysisPanel.tsx: render extraction source and preferred/nice-to-have results without marking them missing.
- Modify README.md: document LLM-first extraction behavior, cache, and fallback.

### Task 1: Define the contract with a failing test

**Files:**
- Create: backend/src/services/analysis/jdRequirementExtractionService.test.ts
- Create: backend/src/services/analysis/jdRequirementExtractionService.ts

- [ ] **Step 1: Write the failing test**

```ts
test("returns categorized requirements and preserves an unknown explicit skill", async () => {
  const service = createJdRequirementExtractionService({
    findCached: async () => null,
    save: async (input) => input,
    extractWithLlm: async () => ({
      requiredSkills: [{
        name: "Databricks",
        priority: "must_have",
        evidence: "Must have Databricks experience.",
        confidence: 0.96,
      }],
      preferredSkills: [{
        name: "Docker",
        priority: "preferred",
        evidence: "Docker experience preferred.",
        confidence: 0.9,
      }],
      niceToHaveSkills: [], responsibilitySkills: [], experienceRequirements: [],
    }),
    extractWithRules: () => { throw new Error("fallback must not run"); },
    model: "qwen-plus", extractionVersion: 1,
  });

  const result = await service.extract({
    jdFileId: "jd1",
    fullText: "Must have Databricks experience. Docker experience preferred.",
  });

  assert.equal(result.source, "llm");
  assert.equal(result.requiredSkills[0]?.canonicalName, "databricks");
  assert.equal(result.preferredSkills[0]?.canonicalName, "docker");
});
```

- [ ] **Step 2: Run the test and verify RED**

Run from backend:

```powershell
node .\node_modules\tsx\dist\cli.mjs --test src/services/analysis/jdRequirementExtractionService.test.ts
```

Expected: failure because createJdRequirementExtractionService is unavailable.

- [ ] **Step 3: Implement the minimum passing service**

```ts
export const createJdRequirementExtractionService = (dependencies: JdRequirementExtractionDependencies) => ({
  async extract(input: { jdFileId: string; fullText: string }): Promise<JdRequirementExtractionResult> {
    const contentHash = createHash("sha256").update(input.fullText).digest("hex");
    const cached = await dependencies.findCached(input.jdFileId, contentHash, dependencies.extractionVersion);
    if (cached) return { ...cached, cached: true };

    try {
      const output = await dependencies.extractWithLlm(input.fullText);
      const validated = llmRequirementSchema.parse(output);
      const normalized = normalizeRequirementGroups(validated);
      await dependencies.save({ jdFileId: input.jdFileId, contentHash, ...normalized });
      return { ...normalized, source: "llm", cached: false };
    } catch {
      return { ...dependencies.extractWithRules(input.fullText), source: "deterministic_fallback", cached: false };
    }
  },
});
```

Require a non-empty skill name/evidence, enumerated priority, and confidence from 0 through 1.

- [ ] **Step 4: Run the test and verify GREEN**

Run: node .\node_modules\tsx\dist\cli.mjs --test src/services/analysis/jdRequirementExtractionService.test.ts from backend.

Expected: the test passes.

- [ ] **Step 5: Commit only the focused files**

```powershell
git add backend/src/services/analysis/jdRequirementExtractionService.ts backend/src/services/analysis/jdRequirementExtractionService.test.ts
git commit -m "feat: add structured JD requirement extraction"
```

### Task 2: Cache validated LLM output and retain a deterministic fallback

**Files:**
- Create: backend/src/models/JdRequirementExtraction.ts
- Modify: backend/src/services/analysis/jdRequirementExtractionService.ts
- Modify: backend/src/services/analysis/jdRequirementExtractionService.test.ts
- Modify: backend/src/services/analysis/skillExtractor.ts

- [ ] **Step 1: Write failing cache and fallback tests**

```ts
test("returns a cache hit without calling Qwen", async () => {
  let llmCalls = 0;
  const service = createJdRequirementExtractionService({
    findCached: async () => cachedLlmExtraction,
    save: async (input) => input,
    extractWithLlm: async () => { llmCalls += 1; return validLlmOutput; },
    extractWithRules: () => fallbackRequirements,
    model: "qwen-plus", extractionVersion: 1,
  });

  const result = await service.extract({ jdFileId: "jd1", fullText: "same JD" });

  assert.equal(result.cached, true);
  assert.equal(llmCalls, 0);
});

test("uses deterministic fallback after malformed model output", async () => {
  const service = createJdRequirementExtractionService({
    findCached: async () => null,
    save: async (input) => input,
    extractWithLlm: async () => ({ requiredSkills: [{ name: "React" }] }),
    extractWithRules: () => fallbackRequirements,
    model: "qwen-plus", extractionVersion: 1,
  });

  const result = await service.extract({ jdFileId: "jd1", fullText: "Must have React" });

  assert.equal(result.source, "deterministic_fallback");
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: node .\node_modules\tsx\dist\cli.mjs --test src/services/analysis/jdRequirementExtractionService.test.ts from backend.

Expected: cache/fallback assertions fail.

- [ ] **Step 3: Add the model and fallback-only path**

Define a unique index on { jdFileId: 1, contentHash: 1, extractionVersion: 1 }. Persist only valid LLM results. Never write a fallback result as an LLM cache record. Export a deterministic categorizer from skillExtractor that maps its current matches to must_have, preferred, and nice_to_have based on cue text.

- [ ] **Step 4: Verify GREEN**

Run: node .\node_modules\tsx\dist\cli.mjs --test src/services/analysis/jdRequirementExtractionService.test.ts from backend.

Expected: valid output, cache hit, and malformed-output fallback tests pass.

- [ ] **Step 5: Commit only focused files**

```powershell
git add backend/src/models/JdRequirementExtraction.ts backend/src/services/analysis/jdRequirementExtractionService.ts backend/src/services/analysis/jdRequirementExtractionService.test.ts backend/src/services/analysis/skillExtractor.ts
git commit -m "feat: cache JD extraction and fall back to rules"
```

### Task 3: Call Qwen safely

**Files:**
- Modify: backend/src/services/analysis/jdRequirementExtractionService.ts
- Modify: backend/src/config/env.ts
- Modify: .env.example
- Modify: backend/src/services/analysis/jdRequirementExtractionService.test.ts

- [ ] **Step 1: Write a failing code-fenced JSON test**

```ts
test("accepts JSON returned inside a markdown code fence", () => {
  const parsed = parseLlmJson(
    "```json\\n{\\"requiredSkills\\":[],\\"preferredSkills\\":[],\\"niceToHaveSkills\\":[],\\"responsibilitySkills\\":[],\\"experienceRequirements\\":[]}\\n```",
  );
  assert.deepEqual(parsed.requiredSkills, []);
});
```

- [ ] **Step 2: Run it and verify RED**

Run: node .\node_modules\tsx\dist\cli.mjs --test src/services/analysis/jdRequirementExtractionService.test.ts from backend.

Expected: failing import or missing parseLlmJson.

- [ ] **Step 3: Implement the adapter and environment setting**

Use the established DashScope compatible endpoint, temperature 0, an evidence-only system prompt, and AbortSignal.timeout(env.JD_REQUIREMENT_EXTRACTION_TIMEOUT_MS). Reject non-OK and empty results; strip a wrapping markdown code fence before JSON parsing and schema validation. Add JD_REQUIREMENT_EXTRACTION_TIMEOUT_MS with a positive default of 15000 to env.ts and .env.example.

- [ ] **Step 4: Verify GREEN and type safety**

```powershell
node .\node_modules\tsx\dist\cli.mjs --test src/services/analysis/jdRequirementExtractionService.test.ts
node .\node_modules\typescript\bin\tsc --noEmit
```

Expected: test passes and TypeScript exits 0.

- [ ] **Step 5: Commit only focused files**

```powershell
git add backend/src/services/analysis/jdRequirementExtractionService.ts backend/src/services/analysis/jdRequirementExtractionService.test.ts backend/src/config/env.ts .env.example
git commit -m "feat: call Qwen for JD requirement extraction"
```

### Task 4: Use only must-have skills in deterministic scoring

**Files:**
- Modify: backend/src/services/analysis/matchAnalysisService.ts
- Modify: backend/src/services/analysis/matchAnalysisService.test.ts

- [ ] **Step 1: Write a failing behavior test**

```ts
test("scores only must-have skills and returns preferred skills separately", async () => {
  const service = createMatchAnalysisService({
    ...dependencies,
    resolveJdRequirements: async () => ({
      source: "llm", cached: false,
      requiredSkills: [mustHaveTypeScript],
      preferredSkills: [preferredDocker],
      niceToHaveSkills: [], responsibilitySkills: [], experienceRequirements: [],
    }),
  });

  const result = await service({ resumeFileId, jdFileId });

  assert.equal(result.scoringMeta.requiredSkillCount, 1);
  assert.equal(result.preferredSkills[0]?.skill, "docker");
  assert.equal(result.missingSkills.some((item) => item.skill === "docker"), false);
});
```

- [ ] **Step 2: Run test and verify RED**

Run: node .\node_modules\tsx\dist\cli.mjs --test src/services/analysis/matchAnalysisService.test.ts from backend.

Expected: a missing result/dependency field, or Docker appears in missingSkills.

- [ ] **Step 3: Integrate the requirement resolver**

Add loadAllChunkText and resolveJdRequirements to MatchAnalysisDependencies. Use full persisted JD chunk text for extraction. Preserve retrieved JD chunks for evidence confidence/domain scoring, but derive requiredSkills only from requirementExtraction.requiredSkills. Build preferredSkills and niceToHaveSkills API items from their JD evidence and matching resume evidence.

- [ ] **Step 4: Verify GREEN and full backend suite**

```powershell
node .\node_modules\tsx\dist\cli.mjs --test src/services/analysis/matchAnalysisService.test.ts
node .\node_modules\tsx\dist\cli.mjs --test src/**/*.test.ts
```

Expected: both commands report zero failures.

- [ ] **Step 5: Commit only focused files**

```powershell
git add backend/src/services/analysis/matchAnalysisService.ts backend/src/services/analysis/matchAnalysisService.test.ts
git commit -m "feat: score mandatory JD skills from LLM extraction"
```

### Task 5: Show provenance and priority in the UI

**Files:**
- Modify: frontend/src/components/MatchAnalysisPanel.tsx
- Modify: README.md

- [ ] **Step 1: Add API contract fields**

Add requirementExtraction metadata containing source, provider, optional model, and cached. Add preferredSkills and niceToHaveSkills to AnalysisResult. Extend skill items so JD classification evidence can be rendered separately from resume evidence.

- [ ] **Step 2: Implement the UI behavior**

Show a success notice when source is llm and state whether it came from cache. Show a warning when source is deterministic_fallback. Render Preferred Qualifications and Nice-to-have Qualifications beneath the mandatory score sections. Keep Missing Skills exclusive to must-have skills.

- [ ] **Step 3: Verify frontend**

```powershell
node .\node_modules\typescript\bin\tsc -b
node .\node_modules\vite\bin\vite.js build
node .\node_modules\eslint\bin\eslint.js src/components/MatchAnalysisPanel.tsx
```

Expected: all three commands exit 0.

- [ ] **Step 4: Document the behavior**

Document Qwen-first extraction, cache reuse, deterministic fallback, the four requirement priorities, and JD_REQUIREMENT_EXTRACTION_TIMEOUT_MS.

- [ ] **Step 5: Commit only focused files**

```powershell
git add frontend/src/components/MatchAnalysisPanel.tsx README.md
git commit -m "feat: show JD extraction source and qualification priorities"
```

### Task 6: Final verification and recording

**Files:**
- Modify: docs/remediation-verification.md

- [ ] **Step 1: Run complete backend verification**

```powershell
node .\node_modules\typescript\bin\tsc --noEmit
node .\node_modules\tsx\dist\cli.mjs --test src/**/*.test.ts
```

Expected: both exit 0 and all tests pass.

- [ ] **Step 2: Run complete frontend verification**

```powershell
node .\node_modules\typescript\bin\tsc -b
node .\node_modules\vite\bin\vite.js build
node .\node_modules\eslint\bin\eslint.js src/components/MatchAnalysisPanel.tsx
```

Expected: all exit 0.

- [ ] **Step 3: Check focused diff and record evidence**

Run git diff --check and git status --short from repository root. Append exact commands, exit statuses, and test totals under a dated “LLM-first JD extraction” heading in docs/remediation-verification.md. Do not overwrite or stage pre-existing user changes.

- [ ] **Step 4: Commit verification record only if it is not already in a focused commit**

```powershell
git add docs/remediation-verification.md
git commit -m "docs: verify LLM-first JD extraction"
```

## Plan Self-Review

- Spec coverage: Tasks 1-3 implement validated Qwen extraction, normalization, cache, timeout, and deterministic fallback. Task 4 implements mandatory-only scoring and response metadata. Task 5 exposes provenance and classification in the UI. Task 6 verifies all required checks.
- Placeholder scan: no TBD/TODO markers or unspecified testing actions remain.
- Type consistency: requiredSkills, preferredSkills, niceToHaveSkills, responsibilitySkills, ExperienceRequirement, and source values are consistent across all tasks.

