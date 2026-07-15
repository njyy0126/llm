import { Schema, model, type InferSchemaType, Types } from "mongoose";

const evidenceRefSchema = new Schema(
  {
    fileId: { type: String, required: true },
    fileName: { type: String, required: true },
    chunkId: { type: String, required: true },
    chunkIndex: { type: Number, required: true },
    score: { type: Number, required: true },
  },
  { _id: false },
);

const skillItemSchema = new Schema(
  {
    skill: { type: String, required: true },
    evidence: { type: [evidenceRefSchema], default: [] },
  },
  { _id: false },
);

const requirementSkillItemSchema = new Schema(
  {
    skill: { type: String, required: true },
    evidence: { type: [evidenceRefSchema], default: [] },
    priority: { type: String, enum: ["preferred", "nice_to_have"], required: true },
    requirementEvidence: { type: String, required: true },
  },
  { _id: false },
);

const requirementExtractionSchema = new Schema(
  {
    source: { type: String, enum: ["llm", "deterministic_fallback"], required: true },
    provider: { type: String, enum: ["qwen"], required: true },
    model: { type: String, required: true },
    cached: { type: Boolean, required: true },
  },
  { _id: false },
);

const breakdownSchema = new Schema(
  {
    skillCoverage: { type: Number, required: true },
    experienceAlignment: { type: Number, required: true },
    toolDepth: { type: Number, required: true },
    domainSimilarity: { type: Number, required: true },
  },
  { _id: false },
);

const recommendationSchema = new Schema(
  {
    title: { type: String, required: true },
    detail: { type: String, required: true },
    relatedSkills: { type: [String], default: [] },
  },
  { _id: false },
);

const scoringMetaSchema = new Schema(
  {
    requiredSkillCount: { type: Number, required: true },
    matchedSkillCount: { type: Number, required: true },
    resumeEvidenceCount: { type: Number, required: true },
    jdEvidenceCount: { type: Number, required: true },
    averageEvidenceScore: { type: Number, required: true },
  },
  { _id: false },
);

const matchAnalysisSchema = new Schema(
  {
    resumeFileId: { type: Types.ObjectId, ref: "IngestedFile", required: true, index: true },
    jdFileId: { type: Types.ObjectId, ref: "IngestedFile", required: true, index: true },
    overallMatchScore: { type: Number, required: true },
    confidence: { type: String, enum: ["low", "medium", "high"], required: true },
    breakdown: { type: breakdownSchema, required: true },
    matchedSkills: { type: [skillItemSchema], default: [] },
    missingSkills: { type: [skillItemSchema], default: [] },
    weakSkills: { type: [skillItemSchema], default: [] },
    preferredSkills: { type: [requirementSkillItemSchema], default: [] },
    niceToHaveSkills: { type: [requirementSkillItemSchema], default: [] },
    requirementExtraction: { type: requirementExtractionSchema, required: true },
    recommendations: { type: [recommendationSchema], default: [] },
    evidenceSummary: { type: [evidenceRefSchema], default: [] },
    scoringMeta: { type: scoringMetaSchema, required: true },
  },
  { timestamps: true },
);

matchAnalysisSchema.index({ resumeFileId: 1, jdFileId: 1, createdAt: -1 });

export type MatchAnalysisDocument = InferSchemaType<typeof matchAnalysisSchema>;

export const MatchAnalysisModel = model("MatchAnalysis", matchAnalysisSchema);
