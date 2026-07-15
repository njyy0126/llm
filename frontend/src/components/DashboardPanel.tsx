import { useCallback, useEffect, useMemo, useState } from "react";

type DashboardSummary = {
  kpis: {
    totalFiles: number;
    filesByType: {
      resume: number;
      job_description: number;
      other: number;
    };
    indexingStatus: {
      indexed: number;
      partial: number;
      not_started: number;
    };
    totalChatSessions: number;
    totalChatMessages: number;
    totalMatchAnalyses: number;
    averageMatchScore: number;
  };
  recentActivity: {
    files: Array<{
      fileId: string;
      fileName: string;
      documentType: "resume" | "job_description" | "other";
      indexingStatus: "indexed" | "partial" | "not_started";
      createdAt: string;
    }>;
    chats: Array<{
      sessionId: string;
      title: string;
      updatedAt: string;
    }>;
    analyses: Array<{
      analysisId: string;
      resumeFileId: string;
      jdFileId: string;
      overallMatchScore: number;
      confidence: "low" | "medium" | "high";
      createdAt: string;
    }>;
  };
};

type MatchTrend = {
  days: number;
  points: Array<{
    day: string;
    analysisCount: number;
    averageScore: number;
  }>;
};

type SkillGapData = {
  limit: number;
  items: Array<{
    skill: string;
    frequency: number;
  }>;
};

const toFriendlyError = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

const formatDate = (value: string): string => new Date(value).toLocaleString();

export default function DashboardPanel() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [fileType, setFileType] = useState<"" | "resume" | "job_description" | "other">("");
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [trend, setTrend] = useState<MatchTrend | null>(null);
  const [skillGaps, setSkillGaps] = useState<SkillGapData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadDashboardData = useCallback(async () => {
    const summaryParams = new URLSearchParams();
    summaryParams.set("days", String(days));
    if (fileType) {
      summaryParams.set("fileType", fileType);
    }

    const trendParams = new URLSearchParams();
    trendParams.set("days", String(days));
    if (fileType) {
      trendParams.set("fileType", fileType);
    }

    const skillGapParams = new URLSearchParams();
    skillGapParams.set("limit", "10");
    if (fileType) {
      skillGapParams.set("fileType", fileType);
    }

    const [summaryRes, trendRes, gapsRes] = await Promise.all([
      fetch(`/api/dashboard/summary?${summaryParams.toString()}`),
      fetch(`/api/dashboard/match-trend?${trendParams.toString()}`),
      fetch(`/api/dashboard/skill-gaps?${skillGapParams.toString()}`),
    ]);

    const [summaryPayload, trendPayload, gapsPayload] = (await Promise.all([
      summaryRes.json(),
      trendRes.json(),
      gapsRes.json(),
    ])) as Array<{ message?: string; data?: unknown }>;

    if (!summaryRes.ok || !summaryPayload.data) {
      throw new Error(summaryPayload.message || "Failed to load dashboard summary.");
    }
    if (!trendRes.ok || !trendPayload.data) {
      throw new Error(trendPayload.message || "Failed to load trend data.");
    }
    if (!gapsRes.ok || !gapsPayload.data) {
      throw new Error(gapsPayload.message || "Failed to load skill gap data.");
    }

    setSummary(summaryPayload.data as DashboardSummary);
    setTrend(trendPayload.data as MatchTrend);
    setSkillGaps(gapsPayload.data as SkillGapData);
  }, [days, fileType]);

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        setError("");
        await loadDashboardData();
      } catch (err) {
        setError(toFriendlyError(err, "Could not load dashboard data."));
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [loadDashboardData]);

  const maxTrendCount = useMemo(() => {
    if (!trend || trend.points.length === 0) return 1;
    return Math.max(...trend.points.map((point) => point.analysisCount), 1);
  }, [trend]);

  const maxGapFrequency = useMemo(() => {
    if (!skillGaps || skillGaps.items.length === 0) return 1;
    return Math.max(...skillGaps.items.map((item) => item.frequency), 1);
  }, [skillGaps]);

  return (
    <section className="card">
      <h2>Operations Dashboard</h2>
      <div className="dashboard-filters">
        <label>
          Time range
          <select value={days} onChange={(event) => setDays(Number(event.target.value) as 7 | 30 | 90)}>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </label>
        <label>
          File type filter (files and analyses; chats remain global)
          <select
            value={fileType}
            onChange={(event) =>
              setFileType(event.target.value as "" | "resume" | "job_description" | "other")
            }
          >
            <option value="">All</option>
            <option value="resume">Resume</option>
            <option value="job_description">Job Description</option>
            <option value="other">Other</option>
          </select>
        </label>
        <button type="button" onClick={() => void loadDashboardData()} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && <p className="notice error-text" role="alert" aria-live="assertive">{error}</p>}

      {!summary || !trend || !skillGaps ? (
        <p className="meta">{loading ? "Loading dashboard..." : "Dashboard data unavailable."}</p>
      ) : (
        <div className="dashboard-stack">
          <div className="kpi-grid">
            <div className="kpi-card">
              <h4>Total Files</h4>
              <p>{summary.kpis.totalFiles}</p>
            </div>
            <div className="kpi-card">
              <h4>Chat Sessions</h4>
              <p>{summary.kpis.totalChatSessions}</p>
            </div>
            <div className="kpi-card">
              <h4>Chat Messages</h4>
              <p>{summary.kpis.totalChatMessages}</p>
            </div>
            <div className="kpi-card">
              <h4>Match Analyses</h4>
              <p>{summary.kpis.totalMatchAnalyses}</p>
            </div>
            <div className="kpi-card">
              <h4>Average Match Score</h4>
              <p>{summary.kpis.averageMatchScore}</p>
            </div>
            <div className="kpi-card">
              <h4>Resumes / JDs / Other</h4>
              <p>
                {summary.kpis.filesByType.resume} / {summary.kpis.filesByType.job_description} /{" "}
                {summary.kpis.filesByType.other}
              </p>
            </div>
          </div>

          <div className="analysis-block">
            <h4>Indexing Health</h4>
            <p>
              Indexed: {summary.kpis.indexingStatus.indexed} | Partial:{" "}
              {summary.kpis.indexingStatus.partial} | Not started:{" "}
              {summary.kpis.indexingStatus.not_started}
            </p>
          </div>

          <div className="dashboard-panels">
            <div className="analysis-block">
              <h4>Match Trend (daily analysis count)</h4>
              {trend.points.length === 0 ? (
                <p className="meta">No analyses in this period.</p>
              ) : (
                <>
                  <p className="meta" id="trend-summary">
                    {trend.points.length} daily data points. Use the data table for exact analysis counts and average match scores.
                  </p>
                  <div className="mini-chart" role="img" aria-describedby="trend-summary">
                    {trend.points.map((point) => (
                      <div key={point.day} className="mini-chart-col" aria-hidden="true">
                        <div
                          className="mini-chart-bar"
                          style={{ height: `${Math.max(10, (point.analysisCount / maxTrendCount) * 100)}px` }}
                        />
                        <span>{point.day.slice(5)}</span>
                      </div>
                    ))}
                  </div>
                  <details className="visual-data-details">
                    <summary>View match trend data table</summary>
                    <table>
                      <caption>Daily match analysis activity</caption>
                      <thead><tr><th scope="col">Date</th><th scope="col">Analyses</th><th scope="col">Average score</th></tr></thead>
                      <tbody>{trend.points.map((point) => <tr key={`trend-${point.day}`}><td>{point.day}</td><td>{point.analysisCount}</td><td>{point.averageScore}</td></tr>)}</tbody>
                    </table>
                  </details>
                </>
              )}
            </div>

            <div className="analysis-block">
              <h4>Top Missing Skills</h4>
              {skillGaps.items.length === 0 ? (
                <p className="meta">No missing skill data yet.</p>
              ) : (
                <><p className="meta">The list reports each missing skill and the number of analyses where it appeared.</p><ul className="gap-list">
                  {skillGaps.items.map((item) => (
                    <li key={`gap-${item.skill}`}>
                      <span>{item.skill}</span>
                      <div className="gap-meter" aria-hidden="true">
                        <div
                          className="gap-meter-fill"
                          style={{ width: `${(item.frequency / maxGapFrequency) * 100}%` }}
                        />
                      </div>
                      <strong>{item.frequency}</strong>
                    </li>
                  ))}
                </ul></>
              )}
            </div>
          </div>

          <div className="dashboard-panels">
            <div className="analysis-block">
              <h4>Recent Files</h4>
              {summary.recentActivity.files.length === 0 ? (
                <p className="meta">No files yet.</p>
              ) : (
                <ul>
                  {summary.recentActivity.files.map((item) => (
                    <li key={`file-${item.fileId}`}>
                      {item.fileName} | {item.documentType} | {item.indexingStatus} |{" "}
                      {formatDate(item.createdAt)}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="analysis-block">
              <h4>Recent Chats</h4>
              {summary.recentActivity.chats.length === 0 ? (
                <p className="meta">No chat sessions yet.</p>
              ) : (
                <ul>
                  {summary.recentActivity.chats.map((item) => (
                    <li key={`chat-${item.sessionId}`}>
                      {item.title} | {formatDate(item.updatedAt)}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="analysis-block">
              <h4>Recent Analyses</h4>
              {summary.recentActivity.analyses.length === 0 ? (
                <p className="meta">No analyses yet.</p>
              ) : (
                <ul>
                  {summary.recentActivity.analyses.map((item) => (
                    <li key={`analysis-${item.analysisId}`}>
                      Score {item.overallMatchScore} | {item.confidence} | {formatDate(item.createdAt)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
