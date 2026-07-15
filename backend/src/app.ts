import cors from "cors";
import express from "express";
import ingestRoutes from "./routes/ingestRoutes";
import vectorRoutes from "./routes/vectorRoutes";
import chatRoutes from "./routes/chatRoutes";
import analysisRoutes from "./routes/analysisRoutes";
import dashboardRoutes from "./routes/dashboardRoutes";
import { errorHandler, notFoundHandler } from "./middlewares/errorHandler";
import { env } from "./config/env";

const app = express();

app.use(
  cors({
    origin: env.CLIENT_ORIGIN,
    credentials: true,
  }),
);
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "rag-career-assistant-backend",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/ingest", ingestRoutes);
app.use("/api/vector", vectorRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/analysis", analysisRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
