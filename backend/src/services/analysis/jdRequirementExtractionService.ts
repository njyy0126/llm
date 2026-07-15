import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError } from "../../utils/AppError";

const QWEN_CHAT_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

export type RequirementPriority =
  | "must_have"
  | "preferred"
  | "nice_to_have"
  | "responsibility";

export type ExtractedSkill = {
  name: string;
  canonicalName: string;
  priority: RequirementPriority;
  evidence: string;
  confidence: number;
};

export type ExperienceRequirement = {
  type: "years" | "education" | "language" | "work_authorization" | "domain" | "other";
  description: string;
  evidence: string;
};

export type RequirementGroups = {
  requiredSkills: ExtractedSkill[];
  preferredSkills: ExtractedSkill[];
  niceToHaveSkills: ExtractedSkill[];
  responsibilitySkills: ExtractedSkill[];
  experienceRequirements: ExperienceRequirement[];
};

export type CachedJdRequirementExtraction = RequirementGroups & {
  provider: "qwen";
  model: string;
};

export type JdRequirementExtractionResult = CachedJdRequirementExtraction & {
  source: "llm" | "deterministic_fallback";
  cached: boolean;
};

type StoredJdRequirementExtraction = CachedJdRequirementExtraction & {
  jdFileId: string;
  contentHash: string;
  extractionVersion: number;
};

const rawSkillSchema = z.object({
  name: z.string().trim().min(1),
  priority: z.enum(["must_have", "preferred", "nice_to_have", "responsibility"]),
  evidence: z.string().trim().min(1),
  confidence: z.number().min(0).max(1),
});

const rawExperienceRequirementSchema = z.object({
  type: z.enum(["years", "education", "language", "work_authorization", "domain", "other"]),
  description: z.string().trim().min(1),
  evidence: z.string().trim().min(1),
});

const llmRequirementSchema = z.object({
  requiredSkills: z.array(rawSkillSchema.extend({ priority: z.literal("must_have") })),
  preferredSkills: z.array(rawSkillSchema.extend({ priority: z.literal("preferred") })),
  niceToHaveSkills: z.array(rawSkillSchema.extend({ priority: z.literal("nice_to_have") })),
  responsibilitySkills: z.array(rawSkillSchema.extend({ priority: z.literal("responsibility") })),
  experienceRequirements: z.array(rawExperienceRequirementSchema),
});

type LlmRequirementPayload = z.infer<typeof llmRequirementSchema>;
type RawSkill = z.infer<typeof rawSkillSchema>;

export const parseLlmJson = (content: string): unknown => {
  const trimmed = content.trim();
  const codeFenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(codeFenceMatch?.[1] ?? trimmed) as unknown;
};

type QwenJdRequirementExtractorDependencies = {
  apiKey: string | undefined;
  model: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
};

export const createQwenJdRequirementExtractor = (
  dependencies: QwenJdRequirementExtractorDependencies,
) => {
  const fetchFn = dependencies.fetchFn ?? fetch;

  return async (fullText: string): Promise<unknown> => {
    if (!dependencies.apiKey) {
      throw new AppError("Missing DASHSCOPE_API_KEY for JD requirement extraction.", 500);
    }

    const systemPrompt = [
      "You extract structured requirements from a job description.",
      "Use only information explicitly stated in the JD.",
      "Do not infer skills, qualifications, seniority, or industry knowledge.",
      "Do not infer skills from a job title or typical role expectations.",
      "Classify each skill as must_have, preferred, nice_to_have, or responsibility.",
      "Every skill and non-skill requirement needs an exact supporting JD excerpt.",
      "Return JSON only. Every skill array must contain objects, never strings.",
      "Use exactly this shape: {\"requiredSkills\":[{\"name\":\"TypeScript\",\"priority\":\"must_have\",\"evidence\":\"Must have TypeScript\",\"confidence\":0.95}],\"preferredSkills\":[{\"name\":\"Docker\",\"priority\":\"preferred\",\"evidence\":\"Docker experience preferred\",\"confidence\":0.9}],\"niceToHaveSkills\":[{\"name\":\"Kubernetes\",\"priority\":\"nice_to_have\",\"evidence\":\"Kubernetes is a plus\",\"confidence\":0.8}],\"responsibilitySkills\":[{\"name\":\"API development\",\"priority\":\"responsibility\",\"evidence\":\"Build backend APIs\",\"confidence\":0.9}],\"experienceRequirements\":[{\"type\":\"years\",\"description\":\"1+ years of experience\",\"evidence\":\"1+ years of experience\"}]}. Use empty arrays when a category has no explicit evidence.",
    ].join(" ");
    const userPrompt = `Job description:\n${fullText}`;

    let response: Response;
    try {
      response = await fetchFn(QWEN_CHAT_ENDPOINT, {
        method: "POST",
        signal: AbortSignal.timeout(dependencies.timeoutMs),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${dependencies.apiKey}`,
        },
        body: JSON.stringify({
          model: dependencies.model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown network error";
      throw new AppError(`Qwen JD extraction network request failed: ${reason}`, 502);
    }

    if (!response.ok) {
      throw new AppError(`Qwen JD extraction request failed with status ${response.status}.`, 502);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new AppError("Qwen JD extraction returned an empty response.", 502);
    }

    return parseLlmJson(content);
  };
};

export type JdRequirementExtractionDependencies = {
  findCached: (
    jdFileId: string,
    contentHash: string,
    extractionVersion: number,
  ) => Promise<CachedJdRequirementExtraction | null>;
  save: (input: StoredJdRequirementExtraction) => Promise<unknown>;
  extractWithLlm: (fullText: string) => Promise<unknown>;
  extractWithRules: (fullText: string) => RequirementGroups;
  model: string;
  extractionVersion: number;
};

const canonicalizeSkillName = (name: string): string =>
  name
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s_\-/]+/g, "_")
    .replace(/[^\p{L}\p{N}_.+#]/gu, "")
    .replace(/^_+|_+$/g, "");

const normalizeSkills = (skills: RawSkill[]): ExtractedSkill[] =>
  skills.map((skill) => ({
    ...skill,
    canonicalName: canonicalizeSkillName(skill.name),
  }));

const normalizeRequirementGroups = (input: LlmRequirementPayload): RequirementGroups => ({
  requiredSkills: normalizeSkills(input.requiredSkills),
  preferredSkills: normalizeSkills(input.preferredSkills),
  niceToHaveSkills: normalizeSkills(input.niceToHaveSkills),
  responsibilitySkills: normalizeSkills(input.responsibilitySkills),
  experienceRequirements: input.experienceRequirements,
});

const normalizeEvidenceText = (value: string): string => value.replace(/\s+/g, " ").trim().toLocaleLowerCase();

const ensureEvidenceIsGrounded = (input: LlmRequirementPayload, fullText: string): void => {
  const normalizedJd = normalizeEvidenceText(fullText);
  const evidenceItems = [
    ...input.requiredSkills,
    ...input.preferredSkills,
    ...input.niceToHaveSkills,
    ...input.responsibilitySkills,
    ...input.experienceRequirements,
  ];
  if (evidenceItems.some((item) => !normalizedJd.includes(normalizeEvidenceText(item.evidence)))) {
    throw new Error("LLM extraction contained evidence that is not present in the JD.");
  }
};

export const createJdRequirementExtractionService = (
  dependencies: JdRequirementExtractionDependencies,
) => ({
  async extract(input: { jdFileId: string; fullText: string }): Promise<JdRequirementExtractionResult> {
    const contentHash = createHash("sha256").update(input.fullText).digest("hex");
    const cached = await dependencies.findCached(
      input.jdFileId,
      contentHash,
      dependencies.extractionVersion,
    );
    if (cached) {
      return { ...cached, source: "llm", cached: true };
    }

    let validated: LlmRequirementPayload;
    try {
      validated = llmRequirementSchema.parse(await dependencies.extractWithLlm(input.fullText));
      ensureEvidenceIsGrounded(validated, input.fullText);
    } catch {
      return {
        ...dependencies.extractWithRules(input.fullText),
        provider: "qwen",
        model: dependencies.model,
        source: "deterministic_fallback",
        cached: false,
      };
    }

    const groups = normalizeRequirementGroups(validated);
    const result: CachedJdRequirementExtraction = {
      ...groups,
      provider: "qwen",
      model: dependencies.model,
    };
    await dependencies.save({
      ...result,
      jdFileId: input.jdFileId,
      contentHash,
      extractionVersion: dependencies.extractionVersion,
    });
    return { ...result, source: "llm", cached: false };
  },
});
