import { Schema, model, type InferSchemaType, Types } from "mongoose";

const extractedSkillSchema = new Schema(
  {
    name: { type: String, required: true },
    canonicalName: { type: String, required: true },
    priority: {
      type: String,
      enum: ["must_have", "preferred", "nice_to_have", "responsibility"],
      required: true,
    },
    evidence: { type: String, required: true },
    confidence: { type: Number, required: true, min: 0, max: 1 },
  },
  { _id: false },
);

const experienceRequirementSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["years", "education", "language", "work_authorization", "domain", "other"],
      required: true,
    },
    description: { type: String, required: true },
    evidence: { type: String, required: true },
  },
  { _id: false },
);

const jdRequirementExtractionSchema = new Schema(
  {
    jdFileId: { type: Types.ObjectId, ref: "IngestedFile", required: true },
    contentHash: { type: String, required: true },
    extractionVersion: { type: Number, required: true },
    provider: { type: String, enum: ["qwen"], required: true },
    model: { type: String, required: true },
    requiredSkills: { type: [extractedSkillSchema], required: true },
    preferredSkills: { type: [extractedSkillSchema], required: true },
    niceToHaveSkills: { type: [extractedSkillSchema], required: true },
    responsibilitySkills: { type: [extractedSkillSchema], required: true },
    experienceRequirements: { type: [experienceRequirementSchema], required: true },
  },
  { timestamps: true },
);

jdRequirementExtractionSchema.index(
  { jdFileId: 1, contentHash: 1, extractionVersion: 1 },
  { unique: true },
);

export type JdRequirementExtractionDocument = InferSchemaType<typeof jdRequirementExtractionSchema>;

export const JdRequirementExtractionModel = model(
  "JdRequirementExtraction",
  jdRequirementExtractionSchema,
);
