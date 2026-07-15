import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type ChatSession = {
  sessionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

type Citation = {
  fileId: string;
  fileName: string;
  chunkId: string;
  chunkIndex: number;
  score: number;
};

type ChatMessage = {
  messageId: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  createdAt: string;
};

type IngestedFileOption = {
  fileId: string;
  originalName: string;
  documentType: "resume" | "job_description" | "other";
};

const toFriendlyError = (error: unknown, fallback: string): string => {
  return error instanceof Error ? error.message : fallback;
};

const formatMessageParagraphs = (content: string): string[] => {
  return content
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
};

export default function ChatPanel() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [indexedFiles, setIndexedFiles] = useState<IngestedFileOption[]>([]);
  const [topK, setTopK] = useState(6);
  const [loading, setLoading] = useState(false);
  const [messageError, setMessageError] = useState("");
  const [operationStatus, setOperationStatus] = useState<"idle" | "loading" | "failed">("loading");
  const [expandedCitationMessageIds, setExpandedCitationMessageIds] = useState<Set<string>>(
    new Set(),
  );
  const lastSubmitSignatureRef = useRef<string>("");
  const lastSubmitAtRef = useRef<number>(0);

  const selectedSession = useMemo(
    () => sessions.find((session) => session.sessionId === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );

  const fetchSessions = useCallback(async () => {
    const response = await fetch("/api/chat/sessions");
    const payload = (await response.json()) as {
      message?: string;
      data?: ChatSession[];
    };
    if (!response.ok || !payload.data) {
      throw new Error(payload.message || "Failed to load chat sessions.");
    }
    setSessions(payload.data);
    if (payload.data.length === 0) {
      setSelectedSessionId("");
      setMessages([]);
      return;
    }
    setSelectedSessionId((currentSessionId) =>
      currentSessionId && payload.data!.some((session) => session.sessionId === currentSessionId)
        ? currentSessionId
        : payload.data![0].sessionId,
    );
  }, []);

  const fetchMessages = useCallback(async (sessionId: string, signal: AbortSignal) => {
    const response = await fetch(`/api/chat/sessions/${sessionId}/messages`, { signal });
    const payload = (await response.json()) as {
      message?: string;
      data?: { messages?: ChatMessage[] };
    };
    if (!response.ok || !payload.data) {
      throw new Error(payload.message || "Failed to load messages.");
    }
    return payload.data.messages ?? [];
  }, []);

  const fetchIndexedFiles = useCallback(async () => {
    const response = await fetch("/api/ingest/files?indexedOnly=true");
    const payload = (await response.json()) as {
      message?: string;
      data?: IngestedFileOption[];
    };
    if (!response.ok || !payload.data) {
      throw new Error(payload.message || "Failed to load indexed files.");
    }
    setIndexedFiles(payload.data);
    setSelectedFileIds((currentFileIds) =>
      currentFileIds.filter((selectedId) => payload.data!.some((file) => file.fileId === selectedId)),
    );
  }, []);

  const refreshWorkspace = useCallback(async () => {
    try {
      setLoading(true);
      setOperationStatus("loading");
      setMessageError("");
      await Promise.all([fetchSessions(), fetchIndexedFiles()]);
      setOperationStatus("idle");
    } catch (error) {
      setMessageError(toFriendlyError(error, "Failed to initialize chat."));
      setOperationStatus("failed");
    } finally {
      setLoading(false);
    }
  }, [fetchIndexedFiles, fetchSessions]);

  const createSession = async () => {
    setMessageError("");
    try {
      setLoading(true);
      setOperationStatus("loading");
      const response = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = (await response.json()) as {
        message?: string;
        data?: ChatSession;
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.message || "Failed to create chat session.");
      }

      await fetchSessions();
      setSelectedSessionId(payload.data.sessionId);
      setMessages([]);
      setOperationStatus("idle");
    } catch (error) {
      setMessageError(toFriendlyError(error, "Could not create session."));
      setOperationStatus("failed");
    } finally {
      setLoading(false);
    }
  };

  const deleteSession = async (sessionId: string) => {
    const shouldDelete = window.confirm("Delete this chat session and all its messages?");
    if (!shouldDelete) {
      return;
    }

    setMessageError("");
    try {
      setLoading(true);
      setOperationStatus("loading");
      const response = await fetch(`/api/chat/sessions/${sessionId}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(payload.message || "Failed to delete chat session.");
      }

      if (selectedSessionId === sessionId) {
        setMessages([]);
      }
      await fetchSessions();
      setOperationStatus("idle");
    } catch (error) {
      setMessageError(toFriendlyError(error, "Could not delete chat session."));
      setOperationStatus("failed");
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) {
      return;
    }
    if (!selectedSessionId) {
      setMessageError("Please create or select a chat session first.");
      return;
    }
    if (!question.trim()) {
      setMessageError("Please enter a question.");
      return;
    }

    const submitSignature = `${selectedSessionId}|${question.trim()}|${[...selectedFileIds].sort().join(",")}|${topK}`;
    const now = Date.now();
    if (submitSignature === lastSubmitSignatureRef.current && now - lastSubmitAtRef.current < 1800) {
      setMessageError("Duplicate submit blocked. Please wait for the previous response.");
      return;
    }
    lastSubmitSignatureRef.current = submitSignature;
    lastSubmitAtRef.current = now;

    try {
      setLoading(true);
      setOperationStatus("loading");
      setMessageError("");
      const response = await fetch(`/api/chat/sessions/${selectedSessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: question.trim(),
          fileIds: selectedFileIds.length > 0 ? selectedFileIds : undefined,
          topK,
        }),
      });
      const payload = (await response.json()) as {
        message?: string;
        data?: {
          userMessage?: ChatMessage;
          assistantMessage?: ChatMessage;
        };
      };

      if (!response.ok || !payload.data?.assistantMessage || !payload.data?.userMessage) {
        throw new Error(payload.message || "Failed to generate chat response.");
      }

      setMessages((prev) => [...prev, payload.data!.userMessage!, payload.data!.assistantMessage!]);
      setQuestion("");
      await fetchSessions();
      setOperationStatus("idle");
    } catch (error) {
      setMessageError(toFriendlyError(error, "Could not send message."));
      setOperationStatus("failed");
    } finally {
      setLoading(false);
    }
  };

  const toggleCitationExpansion = (messageId: string) => {
    setExpandedCitationMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  useEffect(() => {
    const refreshTimer = window.setTimeout(() => {
      void refreshWorkspace();
    }, 0);
    return () => window.clearTimeout(refreshTimer);
  }, [refreshWorkspace]);

  useEffect(() => {
    if (!selectedSessionId) {
      return;
    }

    const controller = new AbortController();
    let isCurrentSessionRequest = true;

    const loadMessages = async () => {
      try {
        setLoading(true);
        setOperationStatus("loading");
        setMessageError("");
        const loadedMessages = await fetchMessages(selectedSessionId, controller.signal);
        if (!isCurrentSessionRequest) {
          return;
        }
        setMessages(loadedMessages);
        setOperationStatus("idle");
      } catch (error) {
        if (!isCurrentSessionRequest || (error instanceof DOMException && error.name === "AbortError")) {
          return;
        }
        setMessageError(toFriendlyError(error, "Failed to load selected session."));
        setOperationStatus("failed");
      } finally {
        if (isCurrentSessionRequest) {
          setLoading(false);
        }
      }
    };

    void loadMessages();
    return () => {
      isCurrentSessionRequest = false;
      controller.abort();
    };
  }, [fetchMessages, selectedSessionId]);

  return (
    <section className="card">
      <h2>Ask Questions (RAG Chat)</h2>
      <div className={`operation-status ${operationStatus}`} role="status" aria-live="polite">
        {operationStatus === "loading" && "Updating chat workspace…"}
        {operationStatus === "failed" && "The last chat operation did not complete."}
      </div>
      <div className="chat-layout">
        <aside className="chat-sessions">
          <div className="chat-sessions-header">
            <strong>Sessions</strong>
            <button type="button" onClick={createSession} disabled={loading}>
              New
            </button>
          </div>
          {sessions.length === 0 ? (
            <p className="meta">No sessions yet.</p>
          ) : (
            <ul>
              {sessions.map((session) => (
                <li key={session.sessionId}>
                  <div className="session-item">
                    <button
                      type="button"
                      className={selectedSessionId === session.sessionId ? "active" : ""}
                      onClick={() => {
                        setSelectedSessionId(session.sessionId);
                        setMessages([]);
                      }}
                    >
                      {session.title}
                    </button>
                    <button
                      type="button"
                      className="session-delete-button"
                      onClick={() => void deleteSession(session.sessionId)}
                      disabled={loading}
                      title="Delete session"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="chat-main">
          <p className="meta">
            {selectedSession ? `Active: ${selectedSession.title}` : "Select or create a session."}
          </p>

          <form className="upload-form" onSubmit={sendMessage}>
            <label>
              Question
              <input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Ask career questions based on indexed documents"
              />
            </label>
            <div className="row">
              <label>
                Optional file filters
                <select
                  className="chat-file-select"
                  multiple
                  size={Math.min(6, Math.max(3, indexedFiles.length))}
                  value={selectedFileIds}
                  onChange={(event) => {
                    const values = Array.from(event.target.selectedOptions).map(
                      (option) => option.value,
                    );
                    setSelectedFileIds(values);
                  }}
                >
                  {indexedFiles.map((file) => (
                    <option key={file.fileId} value={file.fileId}>
                      {file.originalName} ({file.documentType})
                    </option>
                  ))}
                </select>
                <p className="meta">
                  {selectedFileIds.length === 0
                    ? "No file selected: search all indexed files."
                    : `${selectedFileIds.length} file(s) selected.`}
                </p>
              </label>
              <label>
                Top K
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={topK}
                  onChange={(event) => setTopK(Number(event.target.value))}
                />
              </label>
            </div>
            {indexedFiles.length === 0 && (
              <p className="meta">
                No indexed files available yet. Upload and index documents first for file-level
                filtering.
              </p>
            )}
            <button type="submit" disabled={loading}>
              {loading ? "Sending..." : "Send"}
            </button>
          </form>

          {messageError && (
            <div className="notice error-text" role="alert">
              <p>{messageError}</p>
              <button type="button" className="secondary-button" onClick={() => void refreshWorkspace()} disabled={loading}>
                Retry loading workspace
              </button>
            </div>
          )}

          <div className="chat-messages">
            {messages.length === 0 ? (
              <p className="meta">No messages yet.</p>
            ) : (
              messages.map((message) => (
                <article key={message.messageId} className={`chat-bubble ${message.role}`}>
                  <p className="chat-role">{message.role === "user" ? "You" : "Assistant"}</p>
                  <div className="chat-content">
                    {formatMessageParagraphs(message.content).map((paragraph, index) => (
                      <p key={`${message.messageId}-${index}`}>{paragraph}</p>
                    ))}
                  </div>
                  {message.role === "assistant" &&
                    message.content.startsWith("I do not have sufficient evidence") && (
                      <p className="evidence-warning">
                        Insufficient evidence: try indexing more relevant files or removing file
                        filter.
                      </p>
                    )}
                  {message.role === "assistant" && message.citations.length > 0 && (
                    <div className="citation-list">
                      <div className="citation-header">
                        <strong>Evidence Citations ({message.citations.length})</strong>
                        <button
                          type="button"
                          onClick={() => toggleCitationExpansion(message.messageId)}
                        >
                          {expandedCitationMessageIds.has(message.messageId) ? "Collapse" : "Expand"}
                        </button>
                      </div>
                      <ul>
                        {(expandedCitationMessageIds.has(message.messageId)
                          ? message.citations
                          : message.citations.slice(0, 2)
                        ).map((citation) => (
                          <li key={`${message.messageId}-${citation.chunkId}`}>
                            {citation.fileName} | chunk #{citation.chunkIndex} | score{" "}
                            {citation.score.toFixed(4)} | chunkId {citation.chunkId}
                          </li>
                        ))}
                      </ul>
                      {!expandedCitationMessageIds.has(message.messageId) &&
                        message.citations.length > 2 && (
                          <p className="meta">Showing first 2 citations. Click expand for all.</p>
                        )}
                    </div>
                  )}
                </article>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
