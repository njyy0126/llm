# LLM-First JD Requirement Extraction Design

## Goal

Improve JD requirement recognition by using Qwen to extract structured requirements from the full job-description text. The LLM result is the primary source; the existing deterministic keyword extractor is used only when the model cannot produce a valid result.

## Problem

The current \`backend/src/services/analysis/skillExtractor.ts\` identifies skills through a fixed alias table and regular expressions. It cannot reliably recognize skills outside that list, understand Chinese or contextual phrasing, or distinguish a mandatory qualification from a preferred qualification, a bonus, or a responsibility. It also derives requirements from a small retrieved subset of JD chunks.

## Scope

This change covers JD requirement extraction, cache persistence, match-analysis integration, scoring treatment, result provenance, and the Match Analysis UI. It does not delegate scoring to the LLM, alter resume-skill evidence extraction, or add a new model provider.

## Architecture

1. Match analysis loads all text chunks belonging to the selected fully indexed JD.
2. A requirement-extraction service creates a stable hash of the JD text and looks for a cache record matching the file, hash, and extraction-schema version.
3. On a cache miss, the service calls the existing Qwen-compatible DashScope endpoint once. The prompt asks for evidence-backed JSON containing categorized skills and non-skill requirements.
4. The response is parsed and validated with Zod. Every accepted skill must have a non-empty source excerpt and one of \`must_have\`, \`preferred\`, \`nice_to_have\`, or \`responsibility\` priorities.
5. Accepted skills are normalized through the existing alias vocabulary where possible, but unknown skills are retained as normalized slugs rather than discarded.
6. The validated result is cached. If Qwen is unavailable, times out, returns an error, or returns invalid JSON, the existing rule-based extractor produces a fallback result for that request. The fallback result is explicitly marked and is not treated as a successful LLM cache entry.
7. Only \`must_have\` skills become the input to deterministic skill-coverage scoring. Preferred and nice-to-have skills are returned as separate informational match groups.

## Data Contract

The backend persists the following logical record in a new \`JdRequirementExtraction\` collection:

\`\`\`ts
type RequirementPriority = "must_have" | "preferred" | "nice_to_have" | "responsibility";

type ExtractedSkill = {
  name: string;
  canonicalName: string;
  priority: RequirementPriority;
  evidence: string;
  confidence: number;
};

type ExperienceRequirement = {
  type: "years" | "education" | "language" | "work_authorization" | "domain" | "other";
  description: string;
  evidence: string;
};

type JdRequirementExtraction = {
  jdFileId: string;
  contentHash: string;
  extractionVersion: 1;
  provider: "qwen";
  model: string;
  source: "llm";
  requiredSkills: ExtractedSkill[];
  preferredSkills: ExtractedSkill[];
  niceToHaveSkills: ExtractedSkill[];
  responsibilitySkills: ExtractedSkill[];
  experienceRequirements: ExperienceRequirement[];
  createdAt: Date;
  updatedAt: Date;
};
\`\`\`

The match-analysis response additionally includes \`requirementExtraction\` metadata (\`source\`, \`provider\`, \`model\`, \`cached\`) and two new skill groups: \`preferredSkills\` and \`niceToHaveSkills\`. Each item includes JD classification/evidence plus zero or more matching resume evidence references.

## Failure Handling

The extraction call receives an explicit timeout. Missing DashScope credentials, network failures, non-2xx results, empty choices, malformed JSON, or schema validation failures trigger the deterministic fallback. The analysis still succeeds when fallback extraction yields skills. The response identifies the source as \`deterministic_fallback\` and includes a safe explanatory message for the UI. Failures are logged without writing raw JD text or credentials to logs.

## User Experience

The Match Analysis UI shows an extraction-status notice. It identifies whether the JD was interpreted by Qwen or by the deterministic fallback. The current matched/missing/weak lists remain focused on mandatory qualifications. Separate sections show preferred and nice-to-have qualifications, including JD evidence. The UI never presents a preferred or bonus skill as a hard missing requirement.

## Acceptance Criteria

- A JD with an unknown but explicit technology can surface that technology as a requirement through an LLM result.
- \`must_have\` skills and only \`must_have\` skills contribute to the main skill-coverage denominator.
- \`preferred\`, \`nice_to_have\`, and responsibility-only skills are shown separately and do not reduce the primary score.
- A valid same-version, same-content cache record avoids a second LLM call.
- Model API and parsing failures run the deterministic extractor and identify that fallback in the API/UI.
- All new behavior is covered by automated tests; backend typecheck, backend tests, frontend build, and targeted lint pass for changed files.

