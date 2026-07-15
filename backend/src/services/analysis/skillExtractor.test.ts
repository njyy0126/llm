import test from "node:test";
import assert from "node:assert/strict";
import {
  extractDeterministicRequirementGroups,
  extractRequiredSkillsFromJd,
  extractSkillEvidence,
} from "./skillExtractor";
import type { RetrievedChunk } from "../retrievalService";

const jdLikeChunks: RetrievedChunk[] = [
  {
    score: 0.72,
    fileId: "jd1",
    fileName: "jd.txt",
    chunkId: "jd-c1",
    chunkIndex: 0,
    textPreview:
      "Requirements:\n- Proficiency in Python or R, with experience in NLP and/or statistical modelling\n- Knowledge of ESG frameworks and HKEX ESG reporting requirements\n- Experience with data visualisation tools (Power BI, Tableau, or equivalent)",
  },
];

test("extractRequiredSkillsFromJd captures multi-skill requirements", () => {
  const required = extractRequiredSkillsFromJd(jdLikeChunks);
  assert.equal(required.has("python"), true);
  assert.equal(required.has("r"), true);
  assert.equal(required.has("nlp"), true);
  assert.equal(required.has("statistical_modeling"), true);
  assert.equal(required.has("esg"), true);
  assert.equal(required.has("hkex"), true);
  assert.equal(required.has("power_bi"), true);
  assert.equal(required.has("tableau"), true);
  assert.equal(required.size >= 6, true);
});

test("extractSkillEvidence tracks mentions and evidence", () => {
  const evidence = extractSkillEvidence(jdLikeChunks);
  const nlp = evidence.get("nlp");
  assert.equal(Boolean(nlp), true);
  assert.equal((nlp?.mentions ?? 0) >= 1, true);
  assert.equal((nlp?.evidence.length ?? 0) >= 1, true);
});

test("extractRequiredSkillsFromJd detects AI, ML, NLP and frontend cues", () => {
  const jdChunk: RetrievedChunk[] = [
    {
      score: 0.81,
      fileId: "jd2",
      fileName: "jd_stem.txt",
      chunkId: "jd2-c1",
      chunkIndex: 0,
      textPreview:
        "Requirements:\nFundamental understanding of AI concepts, including machine learning and natural language processing;\nWorking knowledge of frontend development;\nDevelop workflow automation solutions, including GenAI/Agentic-AI and RAG-based components.",
    },
  ];

  const required = extractRequiredSkillsFromJd(jdChunk);
  assert.equal(required.has("ai"), true);
  assert.equal(required.has("machine_learning"), true);
  assert.equal(required.has("nlp"), true);
  assert.equal(required.has("frontend"), true);
  assert.equal(required.has("genai"), true);
  assert.equal(required.has("agentic_ai"), true);
  assert.equal(required.has("rag"), true);
});

test("extractRequiredSkillsFromJd captures common full-stack technologies", () => {
  const jdChunk: RetrievedChunk[] = [
    {
      score: 0.79,
      fileId: "jd3",
      fileName: "jd_stack.txt",
      chunkId: "jd3-c1",
      chunkIndex: 0,
      textPreview:
        "Requirements: experience with React, TypeScript, Node.js, PostgreSQL, Docker, Kubernetes, AWS, and CI/CD. Familiarity with GitHub Actions and Jest is preferred.",
    },
  ];

  const required = extractRequiredSkillsFromJd(jdChunk);
  assert.equal(required.has("react"), true);
  assert.equal(required.has("typescript"), true);
  assert.equal(required.has("nodejs"), true);
  assert.equal(required.has("postgresql"), true);
  assert.equal(required.has("docker"), true);
  assert.equal(required.has("kubernetes"), true);
  assert.equal(required.has("aws"), true);
  assert.equal(required.has("ci_cd"), true);
  assert.equal(required.has("github_actions"), true);
  assert.equal(required.has("jest"), true);
});

test("deterministic fallback keeps preferred and bonus skills out of mandatory requirements", () => {
  const requirements = extractDeterministicRequirementGroups(
    "Requirements:\n- Must have TypeScript experience.\n- React experience is preferred.\n- Docker knowledge is a plus.",
  );

  assert.equal(requirements.requiredSkills.some((skill) => skill.canonicalName === "typescript"), true);
  assert.equal(requirements.preferredSkills.some((skill) => skill.canonicalName === "react"), true);
  assert.equal(requirements.niceToHaveSkills.some((skill) => skill.canonicalName === "docker"), true);
  assert.equal(requirements.requiredSkills.some((skill) => skill.canonicalName === "react"), false);
  assert.equal(requirements.requiredSkills.some((skill) => skill.canonicalName === "docker"), false);
});
