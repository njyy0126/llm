import { type FormEvent, useEffect, useMemo, useState } from "react";

type EvidenceRef = {
  fileId: string;
  fileName: string;
  chunkId: string;
  chunkIndex: number;
  score: number;
};

type SkillItem = {
  skill: string;
  evidence: EvidenceRef[];
  priority?: "preferred" | "nice_to_have";
  requirementEvidence?: string;
};

type RequirementExtractionMeta = {
  source: "llm" | "deterministic_fallback";
  provider: "qwen";
  model: string;
  cached: boolean;
};

type Recommendation = {
  title: string;
  detail: string;
  relatedSkills: string[];
};

type AnalysisResult = {
  analysisId: string;
  resumeFileId: string;
  jdFileId: string;
  overallMatchScore: number;
  confidence: "low" | "medium" | "high";
  breakdown: {
    skillCoverage: number;
    experienceAlignment: number;
    toolDepth: number;
    domainSimilarity: number;
  };
  matchedSkills: SkillItem[];
  missingSkills: SkillItem[];
  weakSkills: SkillItem[];
  preferredSkills: SkillItem[];
  niceToHaveSkills: SkillItem[];
  requirementExtraction: RequirementExtractionMeta;
  recommendations: Recommendation[];
  evidenceSummary: EvidenceRef[];
  scoringMeta: {
    requiredSkillCount: number;
    matchedSkillCount: number;
    resumeEvidenceCount: number;
    jdEvidenceCount: number;
    averageEvidenceScore: number;
  };
  createdAt: string;
};

type IngestedFileItem = {
  fileId: string;
  originalName: string;
  documentType: "resume" | "job_description" | "other";
  indexingStatus: "not_started" | "partial" | "indexed";
  chunkCount: number;
  indexedChunkCount: number;
  createdAt: string;
};

type MatchRequest = {
  resumeFileId: string;
  jdFileId: string;
  topK: number;
};

const asFriendlyMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error) return error.message;
  return fallback;
};

const SkillList = ({ title, items }: { title: string; items: SkillItem[] }) => (
  <div className="analysis-block">
    <h4>{title}</h4>
    {items.length === 0 ? (
      <p className="meta">None.</p>
    ) : (
      <ul>
        {items.map((item) => (
          <li key={`${title}-${item.skill}`}>
            <strong>{item.skill}</strong>
            {item.requirementEvidence && (
              <p className="skill-evidence">JD evidence: {item.requirementEvidence}</p>
            )}
            {item.evidence.length > 0 && (
              <div className="skill-evidence">
                {item.evidence.slice(0, 3).map((evidence) => (
                  <p key={`${item.skill}-${evidence.chunkId}`}>
                    {evidence.fileName} | chunk #{evidence.chunkIndex} | score{" "}
                    {evidence.score.toFixed(4)} | {evidence.chunkId}
                  </p>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    )}
  </div>
);

export default function MatchAnalysisPanel() {
  const [resumeFileId, setResumeFileId] = useState("");
  const [jdFileId, setJdFileId] = useState("");
  const [topK, setTopK] = useState(8);
  const [loading, setLoading] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [files, setFiles] = useState<IngestedFileItem[]>([]);
  const [lastRequest, setLastRequest] = useState<MatchRequest | null>(null);

  const fetchFiles = async () => {
    try {
      setFilesLoading(true);
      setErrorMessage("");
      const response = await fetch("/api/ingest/files?indexedOnly=true");
      const payload = (await response.json()) as {
        message?: string;
        data?: IngestedFileItem[];
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.message || "Failed to fetch indexed files.");
      }
      setFiles(payload.data);
    } catch (error) {
      setErrorMessage(asFriendlyMessage(error, "Could not load indexed files."));
      throw error;
    } finally {
      setFilesLoading(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        await fetchFiles();
      } catch { /* fetchFiles already presents a user-facing error */ }
    };
    void load();
  }, []);

  const resumeOptions = useMemo(
    () => files.filter((file) => file.documentType === "resume"),
    [files],
  );
  const jdOptions = useMemo(
    () => files.filter((file) => file.documentType === "job_description"),
    [files],
  );
  const isReady = resumeOptions.length > 0 && jdOptions.length > 0;

  const runAnalysis = async (request: MatchRequest) => {
    setErrorMessage("");
    setResult(null);
    try {
      setLoading(true);
      const response = await fetch("/api/analysis/match", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          resumeFileId: request.resumeFileId,
          jdFileId: request.jdFileId,
          topK: request.topK,
        }),
      });
      const payload = (await response.json()) as {
        message?: string;
        data?: AnalysisResult;
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.message || "Failed to run match analysis.");
      }
      setResult(payload.data);
    } catch (error) {
      setErrorMessage(asFriendlyMessage(error, "Could not run analysis. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  const handleRun = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isReady) {
      setErrorMessage("Match analysis needs at least one indexed resume and one indexed job description.");
      return;
    }
    if (!resumeFileId.trim() || !jdFileId.trim()) {
      setErrorMessage("Select both an indexed resume and an indexed job description.");
      return;
    }
    const request = { resumeFileId: resumeFileId.trim(), jdFileId: jdFileId.trim(), topK };
    setLastRequest(request);
    await runAnalysis(request);
  };

  return (
    <section className="card">
      <h2>Get Match Score and Skill Gaps</h2>
      <div className={`readiness-message ${isReady ? "ready" : "not-ready"}`} role="status" aria-live="polite">
        {filesLoading
          ? "Checking indexed documents…"
          : isReady
            ? "Ready: choose a resume and job description to compare."
            : "Not ready: ingest and index at least one resume and one job description."}
      </div>
      <form className="upload-form" onSubmit={handleRun}>
        <div className="row">
          <label>
            Resume File (indexed)
            <select
              value={resumeFileId}
              onChange={(event) => setResumeFileId(event.target.value)}
            >
              <option value="">Select resume file</option>
              {resumeOptions.map((item) => (
                <option key={`resume-${item.fileId}`} value={item.fileId}>
                  {item.originalName} | {item.fileId}
                </option>
              ))}
            </select>
          </label>
          <label>
            JD File (indexed)
            <select
              value={jdFileId}
              onChange={(event) => setJdFileId(event.target.value)}
            >
              <option value="">Select JD file</option>
              {jdOptions.map((item) => (
                <option key={`jd-${item.fileId}`} value={item.fileId}>
                  {item.originalName} | {item.fileId}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="analysis-inline-actions">
          <button type="button" onClick={() => void fetchFiles()} disabled={loading || filesLoading}>
            {filesLoading ? "Refreshing…" : "Refresh indexed files"}
          </button>
          <p className="meta">
            Resume options: {resumeOptions.length} | JD options: {jdOptions.length}
          </p>
        </div>

        <label>
          Top K retrieval per analysis query
          <input
            type="number"
            min={3}
            max={20}
            value={topK}
            onChange={(event) => setTopK(Number(event.target.value))}
          />
        </label>

        <button type="submit" disabled={loading || filesLoading || !isReady}>
          {loading ? "Analyzing..." : "Run Match Analysis"}
        </button>
      </form>

      {errorMessage && (
        <div className="notice error-text" role="alert" aria-live="assertive">
          <p>{errorMessage}</p>
          {lastRequest && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => void runAnalysis(lastRequest)}
              disabled={loading}
            >
              Retry last analysis
            </button>
          )}
        </div>
      )}

      {result && (
        <div className="analysis-result">
          <div className="analysis-score">
            <h3>Overall Match Score: {result.overallMatchScore}/100</h3>
            <p>
              Confidence: <strong>{result.confidence}</strong>
            </p>
            <p>
              Required skills: {result.scoringMeta.requiredSkillCount} | Matched:{" "}
              {result.scoringMeta.matchedSkillCount}
            </p>
            <p>Average evidence score: {result.scoringMeta.averageEvidenceScore.toFixed(4)}</p>
          </div>

          <div
            className={`readiness-message ${
              result.requirementExtraction.source === "llm" ? "ready" : "not-ready"
            }`}
            role="status"
          >
            {result.requirementExtraction.source === "llm"
              ? `JD requirements were extracted by Qwen${
                  result.requirementExtraction.cached ? " from a validated cache" : ""
                }.`
              : "Qwen requirement extraction was unavailable, so this result uses the basic keyword fallback and may be less precise."}
          </div>

          <div className="analysis-breakdown">
            <h4>Breakdown</h4>
            <ul>
              <li>Skill Coverage: {result.breakdown.skillCoverage}</li>
              <li>Experience Alignment: {result.breakdown.experienceAlignment}</li>
              <li>Tool/Tech Depth: {result.breakdown.toolDepth}</li>
              <li>Domain Similarity: {result.breakdown.domainSimilarity}</li>
            </ul>
          </div>

          <div className="analysis-grid">
            <SkillList title="Matched Skills" items={result.matchedSkills} />
            <SkillList title="Missing Skills" items={result.missingSkills} />
            <SkillList title="Weak Skills" items={result.weakSkills} />
          </div>

          <div className="analysis-grid">
            <SkillList title="Preferred Qualifications" items={result.preferredSkills} />
            <SkillList title="Nice-to-have Qualifications" items={result.niceToHaveSkills} />
          </div>

          <div className="analysis-block">
            <h4>Improvement Recommendations</h4>
            {result.recommendations.length === 0 ? (
              <p className="meta">No recommendations generated.</p>
            ) : (
              <ul>
                {result.recommendations.map((item, index) => (
                  <li key={`${item.title}-${index}`}>
                    <strong>{item.title}</strong>: {item.detail}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="analysis-block">
            <h4>Evidence Summary</h4>
            <ul>
              {result.evidenceSummary.map((item) => (
                <li key={`summary-${item.chunkId}`}>
                  {item.fileName} | chunk #{item.chunkIndex} | score {item.score.toFixed(4)} |{" "}
                  {item.chunkId}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
