import test from "node:test";
import assert from "node:assert/strict";
import { Types } from "mongoose";
import {
  createRagChatService,
  normalizeChatTargetFileIds,
  type RagChatDependencies,
} from "./ragChatService";

const SESSION_ID = "507f1f77bcf86cd799439011";

type StoredMessage = Parameters<RagChatDependencies["createMessage"]>[0] & {
  _id: Types.ObjectId;
  createdAt: Date;
};

const createDependencies = (overrides: Partial<RagChatDependencies> = {}) => {
  const createdMessages: StoredMessage[] = [];
  let titleUpdates = 0;
  let touches = 0;
  const session = { _id: new Types.ObjectId(SESSION_ID) };

  const dependencies: RagChatDependencies = {
    findSessionById: async () => session,
    createMessage: async (message) => {
      const stored: StoredMessage = {
        ...message,
        _id: new Types.ObjectId(),
        createdAt: new Date(),
      };
      createdMessages.push(stored);
      return stored;
    },
    retrieveSimilarChunks: async () => ({ results: [] }),
    generateAnswer: async () => ({ answer: "model answer" }),
    touchSessionUpdatedAt: async () => {
      touches += 1;
    },
    updateSessionTitleIfDefault: async () => {
      titleUpdates += 1;
    },
    chatMaxContextChunks: 5,
    chatMinRelevanceScore: 0.5,
    fallbackToExtractive: false,
    ...overrides,
  };

  return { dependencies, createdMessages, getTitleUpdates: () => titleUpdates, getTouches: () => touches };
};

test("normalizeChatTargetFileIds uses fileIds and deduplicates", () => {
  const result = normalizeChatTargetFileIds({
    fileId: "single",
    fileIds: ["a", "b", "a", " "],
  });
  assert.deepEqual(result, ["a", "b"]);
});

test("normalizeChatTargetFileIds falls back to fileId", () => {
  const result = normalizeChatTargetFileIds({
    fileId: " one ",
  });
  assert.deepEqual(result, ["one"]);
});

test("normalizeChatTargetFileIds returns empty array when none provided", () => {
  assert.deepEqual(normalizeChatTargetFileIds({}), []);
});

test("retrieval failure persists a safe failed assistant message", async () => {
  const originalConsoleError = console.error;
  const loggedValues: unknown[] = [];
  console.error = (...values: unknown[]) => {
    loggedValues.push(...values);
  };
  const harness = createDependencies({
    retrieveSimilarChunks: async () => {
      throw new Error("Qdrant credentials leaked: secret-token");
    },
  });

  try {
    const result = await createRagChatService(harness.dependencies).sendRagMessage({
      sessionId: SESSION_ID,
      question: "What experience do I have?",
    });

    assert.equal(harness.createdMessages.length, 2);
    assert.deepEqual(
      harness.createdMessages.map(({ role, status, failureCode, citations, retrievedChunks }) => ({
        role,
        status,
        failureCode,
        citations,
        retrievedChunks,
      })),
      [
        { role: "user", status: "completed", failureCode: undefined, citations: [], retrievedChunks: [] },
        {
          role: "assistant",
          status: "failed",
          failureCode: "retrieval",
          citations: [],
          retrievedChunks: [],
        },
      ],
    );
    assert.equal(result.assistantMessage.status, "failed");
    assert.equal(result.assistantMessage.failureCode, "retrieval");
    assert.doesNotMatch(result.assistantMessage.content, /secret-token|Qdrant|credentials/i);
    assert.doesNotMatch(
      loggedValues.map((value) => (value instanceof Error ? value.message : String(value))).join(" "),
      /secret-token/i,
    );
    assert.equal(harness.getTitleUpdates(), 0);
    assert.equal(harness.getTouches(), 1);
  } finally {
    console.error = originalConsoleError;
  }
});

test("generation failure without fallback persists a safe failed assistant message", async () => {
  const originalConsoleError = console.error;
  const loggedValues: unknown[] = [];
  console.error = (...values: unknown[]) => {
    loggedValues.push(...values);
  };
  const harness = createDependencies({
    retrieveSimilarChunks: async () => ({
      results: [
        {
          fileId: "507f1f77bcf86cd799439012",
          fileName: "resume.pdf",
          chunkId: "chunk-1",
          chunkIndex: 0,
          score: 0.9,
          textPreview: "Candidate built RAG systems.",
        },
      ],
    }),
    generateAnswer: async () => {
      throw new Error("provider API key secret-token rejected");
    },
  });

  try {
    const result = await createRagChatService(harness.dependencies).sendRagMessage({
      sessionId: SESSION_ID,
      question: "What RAG experience does the candidate have?",
    });

    assert.equal(harness.createdMessages.length, 2);
    assert.equal(harness.createdMessages[1]?.status, "failed");
    assert.equal(harness.createdMessages[1]?.failureCode, "generation");
    assert.deepEqual(harness.createdMessages[1]?.citations, []);
    assert.deepEqual(harness.createdMessages[1]?.retrievedChunks, []);
    assert.equal(result.assistantMessage.status, "failed");
    assert.equal(result.assistantMessage.failureCode, "generation");
    assert.doesNotMatch(result.assistantMessage.content, /secret-token|API key|provider/i);
    assert.doesNotMatch(
      loggedValues.map((value) => (value instanceof Error ? value.message : String(value))).join(" "),
      /secret-token/i,
    );
    assert.equal(harness.getTitleUpdates(), 0);
    assert.equal(harness.getTouches(), 1);
  } finally {
    console.error = originalConsoleError;
  }
});

test("generation failure with fallback persists a completed extractive assistant message", async () => {
  const harness = createDependencies({
    retrieveSimilarChunks: async () => ({
      results: [
        {
          fileId: "507f1f77bcf86cd799439012",
          fileName: "resume.pdf",
          chunkId: "chunk-1",
          chunkIndex: 0,
          score: 0.9,
          textPreview: "Candidate built RAG systems.",
        },
      ],
    }),
    generateAnswer: async () => {
      throw new Error("provider unavailable");
    },
    fallbackToExtractive: true,
  });

  const result = await createRagChatService(harness.dependencies).sendRagMessage({
    sessionId: SESSION_ID,
    question: "What RAG experience does the candidate have?",
  });

  assert.equal(harness.createdMessages.length, 2);
  assert.equal(harness.createdMessages[1]?.status, "completed");
  assert.equal(harness.createdMessages[1]?.failureCode, undefined);
  assert.match(harness.createdMessages[1]?.content ?? "", /extractive answer/i);
  assert.equal(result.assistantMessage.status, "completed");
  assert.equal(result.assistantMessage.failureCode, undefined);
  assert.equal(harness.getTitleUpdates(), 1);
  assert.equal(harness.getTouches(), 1);
});

test("uses the injected context limit consistently for model context and persisted evidence", async () => {
  const retrievedChunks = Array.from({ length: 13 }, (_, index) => ({
    fileId: "507f1f77bcf86cd799439012",
    fileName: "resume.pdf",
    chunkId: `chunk-${index}`,
    chunkIndex: index,
    score: 0.9,
    textPreview: `Evidence ${index}`,
  }));
  let modelContextLength = 0;
  const harness = createDependencies({
    chatMaxContextChunks: 13,
    retrieveSimilarChunks: async () => ({ results: retrievedChunks }),
    generateAnswer: async (_question, contextBlocks) => {
      modelContextLength = contextBlocks.length;
      return { answer: "model answer" };
    },
  });

  const result = await createRagChatService(harness.dependencies).sendRagMessage({
    sessionId: SESSION_ID,
    question: "Summarize the candidate's experience.",
  });

  assert.equal(modelContextLength, 13);
  assert.equal(result.assistantMessage.citations.length, 13);
  assert.equal(result.assistantMessage.retrievedChunks.length, 13);
  assert.equal(result.retrievalSummary.count, 13);
});
