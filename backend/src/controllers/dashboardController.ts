import { NextFunction, Request, Response } from "express";
import {
  getDashboardSummary,
  getMatchTrend,
  getTopSkillGaps,
} from "../services/dashboard/dashboardService";

const getQueryValue = (value: unknown): string | undefined => {
  const firstValue = Array.isArray(value) ? value[0] : value;
  return typeof firstValue === "string" ? firstValue : undefined;
};

type DashboardServiceDependencies = {
  getDashboardSummary: typeof getDashboardSummary;
  getMatchTrend: typeof getMatchTrend;
  getTopSkillGaps: typeof getTopSkillGaps;
};

export const createDashboardControllers = (
  services: DashboardServiceDependencies = {
    getDashboardSummary,
    getMatchTrend,
    getTopSkillGaps,
  },
) => ({
  summary: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const days = getQueryValue(req.query.days);
      const fileType = getQueryValue(req.query.fileType);
      const data = await services.getDashboardSummary({ days, fileType });
      console.log(`[dashboard] summary days=${days ?? "default"} fileType=${fileType ?? "all"}`);
      res.status(200).json({
        message: "Dashboard summary fetched.",
        data,
      });
    } catch (error) {
      next(error);
    }
  },

  matchTrend: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const days = getQueryValue(req.query.days);
      const fileType = getQueryValue(req.query.fileType);
      const data = await services.getMatchTrend({ days, fileType });
      res.status(200).json({
        message: "Match trend fetched.",
        data,
      });
    } catch (error) {
      next(error);
    }
  },

  skillGaps: async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = getQueryValue(req.query.limit);
      const fileType = getQueryValue(req.query.fileType);
      const data = await services.getTopSkillGaps({ limit, fileType });
      res.status(200).json({
        message: "Top skill gaps fetched.",
        data,
      });
    } catch (error) {
      next(error);
    }
  },
});

const dashboardControllers = createDashboardControllers();

export const dashboardSummaryController = dashboardControllers.summary;
export const dashboardMatchTrendController = dashboardControllers.matchTrend;
export const dashboardSkillGapsController = dashboardControllers.skillGaps;
