import { Types } from "mongoose";
import { z } from "zod";
import { env } from "../../config/env";
import { IngestedFileModel } from "../../models/IngestedFile";
import { JdRequirementExtractionModel } from "../../models/JdRequirementExtraction";
import { MatchAnalysisModel } from "../../models/MatchAnalysis";
import { TextChunkModel } from "../../models/TextChunk";
import { VectorIndexModel } from "../../models/VectorIndex";
import { AppError } from "../../utils/AppError";
import { retrieveSimilarChunks, type RetrievedChunk } from "../retrievalService";
import {
  extractDeterministicRequirementGroups,
  extractSkillEvidence,
  type EvidenceRef,
} from "./skillExtractor";
import {
  createJdRequirementExtractionService,
  createQwenJdRequirementExtractor,
  type CachedJdRequirementExtraction,
  type ExtractedSkill,
  type JdRequirementExtractionResult,
} from "./jdRequirementExtractionService";
import { buildRecommendations } from "./recommendationService";
import { scoreMatch } from "./matchScorer";

const requestSchema = z.object({
  resumeFileId: z.string().trim().min(1),
  jdFileId: z.string().trim().min(1),
  topK: z.coerce.number().int().positive().max(20).optional(),
});

const dedupeChunks = (chunks: RetrievedChunk[]): RetrievedChunk[] => {
  const map = new Map<string, RetrievedChunk>();
  for (const chunk of chunks) {
    const existing = map.get(chunk.chunkId);
    if (!existing || chunk.score > existing.score) {
      map.set(chunk.chunkId, chunk);
    }
  }
  return [...map.values()].sort((a, b) => b.score - a.score);
};

type AnalysisFile = {
  id: string;
  originalName: string;
  documentType: "resume" | "job_description" | "other";
  indexingStatus: "not_started" | "partial" | "indexed";
  chunkCount: number;
  indexedChunkCount: number;
};

type SkillItem = { skill: string; evidence: EvidenceRef[] };
type RequirementSkillItem = SkillItem & {
  priority: "preferred" | "nice_to_have";
  requirementEvidence: string;
};
type MatchAnalysisCreateData = {
  resumeFileId: string;
  jdFileId: string;
  overallMatchScore: number;
  confidence: ReturnType<typeof scoreMatch>["confidence"];
  breakdown: ReturnType<typeof scoreMatch>["breakdown"];
  matchedSkills: SkillItem[];
  missingSkills: SkillItem[];
  weakSkills: SkillItem[];
  preferredSkills: RequirementSkillItem[];
  niceToHaveSkills: RequirementSkillItem[];
  requirementExtraction: {
    source: "llm" | "deterministic_fallback";
    provider: "qwen";
    model: string;
    cached: boolean;
  };
  recommendations: ReturnType<typeof buildRecommendations>;
  evidenceSummary: EvidenceRef[];
  scoringMeta: ReturnType<typeof scoreMatch>["scoringMeta"];
};

type MatchAnalysisResult = MatchAnalysisCreateData & {
  analysisId: string;
  createdAt: Date;
};

/**
 * The small boundary around persistence and retrieval keeps the analysis rules
 * deterministic and usable by any caller that supplies equivalent adapters.
 */
export type MatchAnalysisDependencies = {
  findFileById: (fileId: string) => Promise<AnalysisFile | null>;
  countVectorIndexRecords: (fileId: string) => Promise<number>;
  loadAllChunkText: (fileId: string) => Promise<string>;
  resolveJdRequirements: (input: {
    jdFileId: string;
    fullText: string;
  }) => Promise<JdRequirementExtractionResult>;
  retrieveSimilarChunks: typeof retrieveSimilarChunks;
  createAnalysis: (analysis: MatchAnalysisCreateData) => Promise<MatchAnalysisResult>;
};

const JD_REQUIREMENT_EXTRACTION_VERSION = 1;

const defaultJdRequirementExtractionService = createJdRequirementExtractionService({
  findCached: async (jdFileId, contentHash, extractionVersion) => {
    const record = await JdRequirementExtractionModel.findOne({
      jdFileId: new Types.ObjectId(jdFileId),
      contentHash,
      extractionVersion,
    }).lean();
    if (!record) return null;
    return {
      requiredSkills: record.requiredSkills,
      preferredSkills: record.preferredSkills,
      niceToHaveSkills: record.niceToHaveSkills,
      responsibilitySkills: record.responsibilitySkills,
      experienceRequirements: record.experienceRequirements,
      provider: "qwen",
      model: record.model,
    } as unknown as CachedJdRequirementExtraction;
  },
  save: async (input) => {
    await JdRequirementExtractionModel.updateOne(
      {
        jdFileId: new Types.ObjectId(input.jdFileId),
        contentHash: input.contentHash,
        extractionVersion: input.extractionVersion,
      },
      {
        $set: {
          ...input,
          jdFileId: new Types.ObjectId(input.jdFileId),
        },
      },
      { upsert: true },
    );
  },
  extractWithLlm: createQwenJdRequirementExtractor({
    apiKey: env.DASHSCOPE_API_KEY,
    model: env.QWEN_CHAT_MODEL,
    timeoutMs: env.JD_REQUIREMENT_EXTRACTION_TIMEOUT_MS,
  }),
  extractWithRules: extractDeterministicRequirementGroups,
  model: env.QWEN_CHAT_MODEL,
  extractionVersion: JD_REQUIREMENT_EXTRACTION_VERSION,
});

const defaultMatchAnalysisDependencies: MatchAnalysisDependencies = {
  findFileById: async (fileId) => {
    const file = await IngestedFileModel.findById(fileId).select(
      "_id originalName documentType indexingStatus chunkCount indexedChunkCount",
    );
    if (!file) {
      return null;
    }
    return {
      id: file._id.toString(),
      originalName: file.originalName,
      documentType: file.documentType,
      indexingStatus: file.indexingStatus,
      chunkCount: file.chunkCount,
      indexedChunkCount: file.indexedChunkCount,
    };
  },
  countVectorIndexRecords: (fileId) =>
    VectorIndexModel.countDocuments({ fileId: new Types.ObjectId(fileId) }),
  loadAllChunkText: async (fileId) => {
    const chunks = await TextChunkModel.find({ fileId: new Types.ObjectId(fileId) })
      .sort({ chunkIndex: 1 })
      .select("content")
      .lean();
    return chunks.map((chunk) => chunk.content).join("\n");
  },
  resolveJdRequirements: (input) => defaultJdRequirementExtractionService.extract(input),
  retrieveSimilarChunks,
  createAnalysis: async (input) => {
    const analysis = await MatchAnalysisModel.create({
      ...input,
      resumeFileId: new Types.ObjectId(input.resumeFileId),
      jdFileId: new Types.ObjectId(input.jdFileId),
    });
    return {
      analysisId: analysis._id.toString(),
      ...input,
      createdAt: analysis.createdAt,
    };
  },
};

const buildFileScopedEvidence = async (
  file: AnalysisFile,
  queries: string[],
  topK: number,
  dependencies: Pick<MatchAnalysisDependencies, "retrieveSimilarChunks">,
): Promise<RetrievedChunk[]> => {
  const retrievalResponses = await Promise.all(
    queries.map((query) =>
      dependencies.retrieveSimilarChunks({
        query,
        fileId: file.id,
        topK,
      }),
    ),
  );

  return dedupeChunks(
    retrievalResponses
      .flatMap((response) => response.results)
      .filter((chunk) => chunk.fileId === file.id),
  );
};

const buildSkillItems = (
  skills: string[],
  evidenceLookup: Map<string, { evidence: EvidenceRef[] }>,
): Array<{ skill: string; evidence: EvidenceRef[] }> => {
  return skills.map((skill) => ({
    skill,
    evidence: evidenceLookup.get(skill)?.evidence ?? [],
  }));
};

const buildRequirementSkillItems = (
  skills: ExtractedSkill[],
  evidenceLookup: Map<string, { evidence: EvidenceRef[] }>,
): RequirementSkillItem[] => {
  return skills.map((skill) => ({
    skill: skill.canonicalName,
    evidence: evidenceLookup.get(skill.canonicalName)?.evidence ?? [],
    priority: skill.priority === "nice_to_have" ? "nice_to_have" : "preferred",
    requirementEvidence: skill.evidence,
  }));
};

const ensureFileIsReadyForAnalysis = async (
  fileId: string,
  label: "resumeFileId" | "jdFileId",
  expectedDocumentType: "resume" | "job_description",
  dependencies: Pick<MatchAnalysisDependencies, "findFileById" | "countVectorIndexRecords">,
): Promise<AnalysisFile> => {
  if (!Types.ObjectId.isValid(fileId)) {
    throw new AppError(`Invalid ${label} format.`, 400);
  }
  const file = await dependencies.findFileById(fileId);
  if (!file) {
    throw new AppError(`${label} not found.`, 404);
  }
  if (file.documentType !== expectedDocumentType) {
    throw new AppError(`${label} must reference a ${expectedDocumentType} file.`, 400);
  }
  if (
    file.indexingStatus !== "indexed" ||
    file.chunkCount <= 0 ||
    file.indexedChunkCount !== file.chunkCount
  ) {
    throw new AppError(
      `${label} is not fully indexed. Index all file chunks before running analysis.`,
      400,
    );
  }

  const vectorRecordCount = await dependencies.countVectorIndexRecords(fileId);
  if (vectorRecordCount !== file.chunkCount) {
    throw new AppError(
      `${label} vector index is incomplete or inconsistent. Re-index the file before running analysis.`,
      400,
    );
  }

  return file;
};

const JD_QUERIES = [
  "required skills and technologies",
  "must have qualifications responsibilities",
  "experience level seniority requirement",
];
const RESUME_QUERIES = [
  "skills technologies tools used",
  "project implementation achievements built developed",
  "experience years responsibilities ownership",
];

export const createMatchAnalysisService = (dependencies: MatchAnalysisDependencies) => {
  return async (input: z.input<typeof requestSchema>): Promise<MatchAnalysisResult> => {
    const parsed = requestSchema.parse(input);
    const topK = parsed.topK ?? env.M5_ANALYSIS_DEFAULT_TOPK;

    const [resumeFile, jdFile] = await Promise.all([
      ensureFileIsReadyForAnalysis(parsed.resumeFileId, "resumeFileId", "resume", dependencies),
      ensureFileIsReadyForAnalysis(parsed.jdFileId, "jdFileId", "job_description", dependencies),
    ]);

    const [resumeChunks, jdChunks] = await Promise.all([
      buildFileScopedEvidence(resumeFile, RESUME_QUERIES, topK, dependencies),
      buildFileScopedEvidence(jdFile, JD_QUERIES, topK, dependencies),
    ]);

  if (resumeChunks.length === 0 || jdChunks.length === 0) {
    throw new AppError(
      "Not enough indexed evidence to run analysis. Please index both resume and JD files first.",
      400,
    );
  }

  const jdFullText = await dependencies.loadAllChunkText(jdFile.id);
  if (!jdFullText.trim()) {
    throw new AppError("JD has no extracted text available for requirement analysis.", 400);
  }
  const requirementExtraction = await dependencies.resolveJdRequirements({
    jdFileId: jdFile.id,
    fullText: jdFullText,
  });
  const jdSkillEvidence = extractSkillEvidence(jdChunks);
  const resumeSkillEvidence = extractSkillEvidence(resumeChunks);
  const requiredSkills = new Set(
    requirementExtraction.requiredSkills.map((skill) => skill.canonicalName),
  );
  const resumeSkills = new Set(resumeSkillEvidence.keys());

  const matchedSkills = new Set(
    [...requiredSkills].filter((skill) => {
      return resumeSkills.has(skill);
    }),
  );
  const missingSkills = [...requiredSkills].filter((skill) => !resumeSkills.has(skill));
  const weakSkills = [...matchedSkills].filter((skill) => {
    const evidence = resumeSkillEvidence.get(skill);
    if (!evidence) return false;
    return evidence.mentions <= 1 || evidence.maxScore < 0.3;
  });

  const scoreResult = scoreMatch({
    requiredSkills,
    matchedSkills,
    resumeSkillEvidence,
    resumeChunks,
    jdChunks,
    weakSkills: new Set(weakSkills),
  });

  const recommendations = buildRecommendations({
    missingSkills,
    weakSkills,
    experienceScore: scoreResult.breakdown.experienceAlignment,
    toolDepthScore: scoreResult.breakdown.toolDepth,
  });

  const matchedItems = buildSkillItems([...matchedSkills].sort(), resumeSkillEvidence);
  const missingItems = buildSkillItems(missingSkills.sort(), jdSkillEvidence);
  const weakItems = buildSkillItems(weakSkills.sort(), resumeSkillEvidence);
  const preferredItems = buildRequirementSkillItems(
    requirementExtraction.preferredSkills,
    resumeSkillEvidence,
  );
  const niceToHaveItems = buildRequirementSkillItems(
    requirementExtraction.niceToHaveSkills,
    resumeSkillEvidence,
  );
  const evidenceSummary = [...resumeChunks, ...jdChunks]
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((chunk) => ({
      fileId: chunk.fileId,
      fileName: chunk.fileName,
      chunkId: chunk.chunkId,
      chunkIndex: chunk.chunkIndex,
      score: chunk.score,
    }));

    return dependencies.createAnalysis({
      resumeFileId: parsed.resumeFileId,
      jdFileId: parsed.jdFileId,
      overallMatchScore: scoreResult.overallMatchScore,
      confidence: scoreResult.confidence,
      breakdown: scoreResult.breakdown,
      matchedSkills: matchedItems,
      missingSkills: missingItems,
      weakSkills: weakItems,
      preferredSkills: preferredItems,
      niceToHaveSkills: niceToHaveItems,
      requirementExtraction: {
        source: requirementExtraction.source,
        provider: requirementExtraction.provider,
        model: requirementExtraction.model,
        cached: requirementExtraction.cached,
      },
      recommendations,
      evidenceSummary,
      scoringMeta: scoreResult.scoringMeta,
    });
  };
};

export const runMatchAnalysis = createMatchAnalysisService(defaultMatchAnalysisDependencies);

export const getRecentAnalyses = async (input: {
  resumeFileId?: string;
  jdFileId?: string;
}) => {
  const filter: { resumeFileId?: Types.ObjectId; jdFileId?: Types.ObjectId } = {};

  if (input.resumeFileId) {
    if (!Types.ObjectId.isValid(input.resumeFileId)) {
      throw new AppError("Invalid resumeFileId format.", 400);
    }
    filter.resumeFileId = new Types.ObjectId(input.resumeFileId);
  }
  if (input.jdFileId) {
    if (!Types.ObjectId.isValid(input.jdFileId)) {
      throw new AppError("Invalid jdFileId format.", 400);
    }
    filter.jdFileId = new Types.ObjectId(input.jdFileId);
  }

  const analyses = await MatchAnalysisModel.find(filter).sort({ createdAt: -1 }).limit(20);
  return analyses.map((item) => ({
    analysisId: item._id.toString(),
    resumeFileId: item.resumeFileId.toString(),
    jdFileId: item.jdFileId.toString(),
    overallMatchScore: item.overallMatchScore,
    confidence: item.confidence,
    createdAt: item.createdAt,
  }));
};
