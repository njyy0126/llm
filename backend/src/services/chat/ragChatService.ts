import { Types } from "mongoose";
import { z } from "zod";
import { env } from "../../config/env";
import { AppError } from "../../utils/AppError";
import { retrieveSimilarChunks, type RetrievedChunk } from "../retrievalService";
import { generateQwenChatAnswer } from "./qwenChatService";
import { ChatSessionModel } from "../../models/ChatSession";
import { ChatMessageModel } from "../../models/ChatMessage";
import { touchSessionUpdatedAt, updateSessionTitleIfDefault } from "./chatSessionService";
import { hasSufficientEvidence, INSUFFICIENT_EVIDENCE_TEXT } from "./chatQuality";

const sendMessageSchema = z.object({
  sessionId: z.string().trim().min(1),
  question: z.string().trim().min(2, "Question must be at least 2 characters."),
  topK: z.coerce.number().int().positive().max(20).optional(),
  fileId: z.string().trim().optional(),
  fileIds: z.array(z.string().trim().min(1)).max(20).optional(),
});

const isValidObjectId = (value: string): boolean => Types.ObjectId.isValid(value);

export const normalizeChatTargetFileIds = (input: {
  fileId?: string;
  fileIds?: string[];
}): string[] => {
  const fromArray = (input.fileIds ?? []).map((id) => id.trim()).filter(Boolean);
  if (fromArray.length > 0) {
    return [...new Set(fromArray)];
  }
  if (input.fileId?.trim()) {
    return [input.fileId.trim()];
  }
  return [];
};

const buildContextBlocks = (chunks: RetrievedChunk[], maxContextChunks: number): string[] => {
  return chunks.slice(0, maxContextChunks).map((chunk) => {
    return [
      `source_file: ${chunk.fileName}`,
      `chunk_index: ${chunk.chunkIndex}`,
      `chunk_id: ${chunk.chunkId}`,
      `similarity_score: ${chunk.score.toFixed(4)}`,
      `content:`,
      chunk.textPreview,
    ].join("\n");
  });
};

const buildCitations = (chunks: RetrievedChunk[]) => {
  return chunks.map((chunk) => ({
    fileId: chunk.fileId,
    fileName: chunk.fileName,
    chunkId: chunk.chunkId,
    chunkIndex: chunk.chunkIndex,
    score: chunk.score,
  }));
};
type CitationItem = ReturnType<typeof buildCitations>[number];

export type ChatMessageStatus = "completed" | "failed";
export type ChatMessageFailureCode = "retrieval" | "generation";

type ChatMessageInput = {
  sessionId: Types.ObjectId;
  role: "user" | "assistant";
  content: string;
  citations: CitationItem[];
  retrievedChunks: RetrievedChunk[];
  status?: ChatMessageStatus;
  failureCode?: ChatMessageFailureCode;
};

type StoredChatMessage = ChatMessageInput & {
  _id: Types.ObjectId;
  createdAt: Date;
};

type ChatSessionReference = {
  _id: Types.ObjectId;
};

export type RagChatDependencies = {
  findSessionById: (sessionId: string) => Promise<ChatSessionReference | null>;
  createMessage: (message: ChatMessageInput) => Promise<StoredChatMessage>;
  retrieveSimilarChunks: (input: {
    query: string;
    topK: number;
    fileIds?: string[];
  }) => Promise<{ results: RetrievedChunk[] }>;
  generateAnswer: (question: string, contextBlocks: string[]) => Promise<{
    answer: string;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  }>;
  touchSessionUpdatedAt: (sessionId: string) => Promise<void>;
  updateSessionTitleIfDefault: (sessionId: string, titleCandidate: string) => Promise<void>;
  chatMaxContextChunks: number;
  chatMinRelevanceScore: number;
  fallbackToExtractive: boolean;
};

const buildExtractiveFallbackAnswer = (chunks: RetrievedChunk[]): string => {
  const summaryLines = chunks.slice(0, 3).map((chunk, index) => {
    return `- Evidence ${index + 1} (${chunk.fileName}, chunk ${chunk.chunkIndex}): ${chunk.textPreview}`;
  });

  return [
    "I cannot reach the chat model right now, so here is an extractive answer from retrieved evidence:",
    ...summaryLines,
  ].join("\n");
};

const SAFE_FAILURE_TEXT = "I’m sorry, I can’t answer that right now. Please try again.";

const logChatFailure = (failureCode: ChatMessageFailureCode): void => {
  console.error(`[chat] failure category=${failureCode} code=rag_${failureCode}_failed`);
};

const defaultRagChatDependencies: RagChatDependencies = {
  findSessionById: async (sessionId) =>
    (await ChatSessionModel.findById(sessionId)) as unknown as ChatSessionReference | null,
  createMessage: async (message) =>
    (await ChatMessageModel.create(message)) as unknown as StoredChatMessage,
  retrieveSimilarChunks,
  generateAnswer: async (question, contextBlocks) => {
    const result = await generateQwenChatAnswer(question, contextBlocks);
    return { answer: result.answer, usage: result.usage ?? undefined };
  },
  touchSessionUpdatedAt,
  updateSessionTitleIfDefault,
  chatMaxContextChunks: env.CHAT_MAX_CONTEXT_CHUNKS,
  chatMinRelevanceScore: env.CHAT_MIN_RELEVANCE_SCORE,
  fallbackToExtractive: env.CHAT_FALLBACK_TO_EXTRACTIVE,
};

export const createRagChatService = (dependencies: RagChatDependencies = defaultRagChatDependencies) => {
  const sendRagMessage = async (input: z.input<typeof sendMessageSchema>) => {
    const parsed = sendMessageSchema.parse(input);
    const targetFileIds = normalizeChatTargetFileIds(parsed);
    if (!isValidObjectId(parsed.sessionId)) {
      throw new AppError("Invalid sessionId format.", 400);
    }
    if (targetFileIds.some((id) => !isValidObjectId(id))) {
      throw new AppError("Invalid fileId format.", 400);
    }

    const session = await dependencies.findSessionById(parsed.sessionId);
    if (!session) {
      throw new AppError("Chat session not found.", 404);
    }

    const userMessage = await dependencies.createMessage({
      sessionId: session._id,
      role: "user",
      content: parsed.question,
      citations: [],
      retrievedChunks: [],
      status: "completed",
    });

    let retrievedChunks: RetrievedChunk[] = [];
    let enoughEvidence = false;
    let assistantContent = INSUFFICIENT_EVIDENCE_TEXT;
    let citations: CitationItem[] = [];
    let status: ChatMessageStatus = "completed";
    let failureCode: ChatMessageFailureCode | undefined;

    try {
      const retrieval = await dependencies.retrieveSimilarChunks({
        query: parsed.question,
        topK: parsed.topK ?? dependencies.chatMaxContextChunks,
        fileIds: targetFileIds.length > 0 ? targetFileIds : undefined,
      });
      retrievedChunks = retrieval.results.slice(0, dependencies.chatMaxContextChunks);
      console.log(
        `[chat] session=${parsed.sessionId} retrieved=${retrievedChunks.length} topScore=${retrievedChunks[0]?.score ?? 0}`,
      );
    } catch {
      logChatFailure("retrieval");
      assistantContent = SAFE_FAILURE_TEXT;
      status = "failed";
      failureCode = "retrieval";
    }

    if (status === "completed") {
      enoughEvidence = hasSufficientEvidence(retrievedChunks, dependencies.chatMinRelevanceScore);
      if (enoughEvidence) {
        const contextBlocks = buildContextBlocks(retrievedChunks, dependencies.chatMaxContextChunks);
        try {
          const llmResult = await dependencies.generateAnswer(parsed.question, contextBlocks);
          assistantContent = llmResult.answer;
          if (llmResult.usage) {
            console.log(
              `[chat] token_usage prompt=${llmResult.usage.prompt_tokens ?? 0} completion=${llmResult.usage.completion_tokens ?? 0} total=${llmResult.usage.total_tokens ?? 0}`,
            );
          }
        } catch {
          logChatFailure("generation");
          if (dependencies.fallbackToExtractive) {
            assistantContent = buildExtractiveFallbackAnswer(retrievedChunks);
          } else {
            assistantContent = SAFE_FAILURE_TEXT;
            status = "failed";
            failureCode = "generation";
          }
        }

        if (status === "completed") {
          citations = buildCitations(retrievedChunks);
        }
      }
    }

    const assistantMessage = await dependencies.createMessage({
      sessionId: session._id,
      role: "assistant",
      content: assistantContent,
      citations,
      retrievedChunks: status === "completed" ? retrievedChunks : [],
      status,
      failureCode,
    });

    await dependencies.touchSessionUpdatedAt(parsed.sessionId);
    if (status === "completed") {
      await dependencies.updateSessionTitleIfDefault(parsed.sessionId, parsed.question);
    }

    return {
      sessionId: parsed.sessionId,
      userMessage: {
        messageId: userMessage._id.toString(),
        role: userMessage.role,
        content: userMessage.content,
        createdAt: userMessage.createdAt,
      },
      assistantMessage: {
        messageId: assistantMessage._id.toString(),
        role: assistantMessage.role,
        content: assistantMessage.content,
        citations: assistantMessage.citations,
        retrievedChunks: assistantMessage.retrievedChunks,
        status: assistantMessage.status ?? "completed",
        failureCode: assistantMessage.failureCode,
        createdAt: assistantMessage.createdAt,
      },
      retrievalSummary: {
        count: retrievedChunks.length,
        topScore: retrievedChunks[0]?.score ?? null,
        usedEvidence: enoughEvidence,
      },
    };
  };

  return { sendRagMessage };
};

export const sendRagMessage = createRagChatService().sendRagMessage;
