# Frontend API-preservation checklist

This checklist was captured before moving the document operations out of `App.tsx`.

| Workflow | Contract retained |
| --- | --- |
| Service status | `GET /api/health`, consumes optional `timestamp` |
| Index status | `GET /api/vector/index/status` |
| Document ingestion | `POST /api/ingest` with `FormData`: `file`, `documentType`, `chunkSize`, `overlap` |
| Remove uploaded documents | `DELETE /api/ingest/files` |
| Index one document | `POST /api/vector/index/file/:fileId` (used by auto, manual, and specified-file actions) |
| Index pending documents | `POST /api/vector/index/all` |
| Clear vectors | `DELETE /api/vector/index/all` |
| Retrieval debugger | `POST /api/vector/retrieve` JSON `{ query, topK, fileId? }` |
| Chat | Existing `/api/chat/sessions`, `/api/chat/sessions/:sessionId`, and message endpoints remain unchanged |
| Match analysis | `GET /api/ingest/files?indexedOnly=true` and `POST /api/analysis/match` remain unchanged |
| Dashboard | Existing `/api/dashboard/summary`, `/api/dashboard/match-trend`, and `/api/dashboard/skill-gaps` query behavior remains unchanged |

The visual rewrite must not introduce router, legacy analytics-integration, Insights, or chart-library dependencies.
