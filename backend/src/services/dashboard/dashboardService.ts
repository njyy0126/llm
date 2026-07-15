import { z } from "zod";
import { IngestedFileModel } from "../../models/IngestedFile";
import { ChatSessionModel } from "../../models/ChatSession";
import { ChatMessageModel } from "../../models/ChatMessage";
import { MatchAnalysisModel } from "../../models/MatchAnalysis";

const fileTypeSchema = z.enum(["resume", "job_description", "other"]);

export type DashboardFileType = z.infer<typeof fileTypeSchema>;

const summaryQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(365).default(30),
  fileType: fileTypeSchema.optional(),
});

const trendQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(365).default(30),
  fileType: fileTypeSchema.optional(),
});

const skillGapQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).default(10),
  fileType: fileTypeSchema.optional(),
});

export const buildDashboardFilters = (
  fileType: DashboardFileType | undefined,
  fileIds: unknown[] = [],
) => {
  const fileFilter = fileType ? { documentType: fileType } : {};

  if (fileType === "resume") {
    return {
      fileFilter,
      analysisFilter: { resumeFileId: { $in: fileIds } },
    };
  }

  if (fileType === "job_description") {
    return {
      fileFilter,
      analysisFilter: { jdFileId: { $in: fileIds } },
    };
  }

  if (fileType === "other") {
    return {
      fileFilter,
      analysisFilter: { _id: { $in: [] } },
    };
  }

  return { fileFilter, analysisFilter: {} };
};

const resolveDashboardFilters = async (fileType: DashboardFileType | undefined) => {
  const filters = buildDashboardFilters(fileType);
  if (!fileType || fileType === "other") return filters;

  const selectedFiles = await IngestedFileModel.find(filters.fileFilter).select("_id");
  return buildDashboardFilters(
    fileType,
    selectedFiles.map((file) => file._id),
  );
};

export const aggregateSkillGapsFromAnalyses = (
  analyses: Array<{
    missingSkills: Array<{ skill: string }>;
  }>,
) => {
  const counter = new Map<string, number>();
  for (const analysis of analyses) {
    for (const item of analysis.missingSkills ?? []) {
      const key = item.skill.toLowerCase().trim();
      if (!key) continue;
      counter.set(key, (counter.get(key) ?? 0) + 1);
    }
  }

  return [...counter.entries()]
    .map(([skill, frequency]) => ({ skill, frequency }))
    .sort((a, b) => b.frequency - a.frequency || a.skill.localeCompare(b.skill));
};

const formatDay = (value: Date): string => value.toISOString().slice(0, 10);

export const getDashboardSummary = async (input: { days?: string; fileType?: string }) => {
  const parsed = summaryQuerySchema.parse(input);
  const since = new Date(Date.now() - parsed.days * 24 * 60 * 60 * 1000);
  const { fileFilter, analysisFilter } = await resolveDashboardFilters(parsed.fileType);
  const [totalFiles, fileTypeRows, indexingRows, totalChatSessions, totalChatMessages, analysisStats] =
    await Promise.all([
      IngestedFileModel.countDocuments(fileFilter),
      IngestedFileModel.aggregate([
        { $match: fileFilter },
        { $group: { _id: "$documentType", count: { $sum: 1 } } },
      ]),
      IngestedFileModel.aggregate([
        { $match: fileFilter },
        { $group: { _id: "$indexingStatus", count: { $sum: 1 } } },
      ]),
      ChatSessionModel.countDocuments(),
      ChatMessageModel.countDocuments(),
      MatchAnalysisModel.aggregate([
        { $match: analysisFilter },
        {
          $group: {
            _id: null,
            totalMatchAnalyses: { $sum: 1 },
            averageMatchScore: { $avg: "$overallMatchScore" },
          },
        },
      ]),
    ]);

  const filesByType = {
    resume: 0,
    job_description: 0,
    other: 0,
  };
  for (const row of fileTypeRows) {
    if (row?._id in filesByType) {
      filesByType[row._id as keyof typeof filesByType] = row.count as number;
    }
  }

  const indexingStatus = {
    indexed: 0,
    partial: 0,
    not_started: 0,
  };
  for (const row of indexingRows) {
    if (row?._id in indexingStatus) {
      indexingStatus[row._id as keyof typeof indexingStatus] = row.count as number;
    }
  }

  const [recentFiles, recentChats, recentAnalyses] = await Promise.all([
    IngestedFileModel.find(fileFilter).sort({ createdAt: -1 }).limit(8),
    ChatSessionModel.find({ updatedAt: { $gte: since } }).sort({ updatedAt: -1 }).limit(8),
    MatchAnalysisModel.find({ createdAt: { $gte: since }, ...analysisFilter })
      .sort({ createdAt: -1 })
      .limit(8),
  ]);

  return {
    kpis: {
      totalFiles,
      filesByType,
      indexingStatus,
      totalChatSessions,
      totalChatMessages,
      totalMatchAnalyses: analysisStats[0]?.totalMatchAnalyses ?? 0,
      averageMatchScore: Math.round(analysisStats[0]?.averageMatchScore ?? 0),
    },
    recentActivity: {
      files: recentFiles.map((item) => ({
        fileId: item._id.toString(),
        fileName: item.originalName,
        documentType: item.documentType,
        indexingStatus: item.indexingStatus,
        createdAt: item.createdAt,
      })),
      chats: recentChats.map((item) => ({
        sessionId: item._id.toString(),
        title: item.title,
        updatedAt: item.updatedAt,
      })),
      analyses: recentAnalyses.map((item) => ({
        analysisId: item._id.toString(),
        resumeFileId: item.resumeFileId.toString(),
        jdFileId: item.jdFileId.toString(),
        overallMatchScore: item.overallMatchScore,
        confidence: item.confidence,
        createdAt: item.createdAt,
      })),
    },
  };
};

export const getMatchTrend = async (input: { days?: string; fileType?: string }) => {
  const parsed = trendQuerySchema.parse(input);
  const since = new Date(Date.now() - parsed.days * 24 * 60 * 60 * 1000);
  const { analysisFilter } = await resolveDashboardFilters(parsed.fileType);

  const analyses = await MatchAnalysisModel.find({ createdAt: { $gte: since }, ...analysisFilter }).select(
    "overallMatchScore createdAt",
  );

  const bucket = new Map<string, { count: number; scoreSum: number }>();
  for (const analysis of analyses) {
    const day = formatDay(analysis.createdAt);
    const row = bucket.get(day) ?? { count: 0, scoreSum: 0 };
    row.count += 1;
    row.scoreSum += analysis.overallMatchScore;
    bucket.set(day, row);
  }

  const data = [...bucket.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, row]) => ({
      day,
      analysisCount: row.count,
      averageScore: Math.round(row.scoreSum / row.count),
    }));

  return {
    days: parsed.days,
    points: data,
  };
};

export const getTopSkillGaps = async (input: { limit?: string; fileType?: string }) => {
  const parsed = skillGapQuerySchema.parse(input);
  const { analysisFilter } = await resolveDashboardFilters(parsed.fileType);
  const analyses = await MatchAnalysisModel.find(analysisFilter)
    .sort({ createdAt: -1 })
    .limit(500)
    .select("missingSkills");
  const ranked = aggregateSkillGapsFromAnalyses(
    analyses.map((item) => ({
      missingSkills: item.missingSkills.map((skill) => ({ skill: skill.skill })),
    })),
  );

  return {
    limit: parsed.limit,
    items: ranked.slice(0, parsed.limit),
  };
};
