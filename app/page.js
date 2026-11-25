"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const CHAT_SESSIONS_KEY = "archemist_hr_chat_sessions_v1";
const ACTIVE_SESSION_KEY = "archemist_hr_active_session_id";

const SAMPLE_QUESTIONS = [
  "What are the official shift timings and late threshold rules?",
  "How does the multi-tier leave approval workflow work?",
  "What happens when I close my browser tab?",
  "How do I onboard or offboard an employee?",
];

function makeId(prefix = "chat") {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createWelcomeMessage() {
  return {
    id: makeId("welcome"),
    role: "assistant",
    content: "Hello! I am your Assistant. How can I assist you today?",
    timestamp: Date.now(),
    chunks: undefined,
    rewrittenQuery: null,
    modelUsed: null,
    isWelcome: true,
    isChitchat: true,
  };
}

function createSession(title = "New Conversation") {
  const now = Date.now();
  return {
    id: makeId("session"),
    title,
    createdAt: now,
    updatedAt: now,
    messages: [createWelcomeMessage()],
  };
}

function stripSectionCitations(text) {
  if (!text) return "";
  return text
    .replace(/\s*\[Section\s*\d*[^\]]*\]/gi, "")
    .replace(/\s*\(Section\s*\d+[^)]*\)/gi, "");
}

function renderInlineFormatting(line) {
  const cleanedLine = stripSectionCitations(line);
  const parts = cleanedLine.split(/(\*\*.*?\*\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-stone-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 mx-0.5 rounded bg-stone-100 text-[#3D428B] font-mono text-[12px] border border-stone-200/80"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

function renderMessageText(text) {
  if (!text) return null;
  const lines = stripSectionCitations(text).split("\n");
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className="h-1" />;
        if (/^[-*•]\s+/.test(trimmed)) {
          const content = trimmed.replace(/^[-*•]\s+/, "");
          return (
            <div key={i} className="flex items-start gap-2 pl-1">
              <span className="text-[#D07A1E] font-bold select-none">&bull;</span>
              <span>{renderInlineFormatting(content)}</span>
            </div>
          );
        }
        return <p key={i}>{renderInlineFormatting(line)}</p>;
      })}
    </div>
  );
}

function cleanTitle(prompt) {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  return cleaned.length <= 40 ? cleaned : `${cleaned.slice(0, 40).trimEnd()}…`;
}

function formatRelativeTime(timestamp) {
  const diff = Math.max(0, Date.now() - timestamp);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "Just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 2 * day) return "Yesterday";
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" });
}

function getHistoryGroup(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 24 * 60 * 60 * 1000;
  const startSevenDays = startToday - 7 * 24 * 60 * 60 * 1000;
  if (timestamp >= startToday) return "Today";
  if (timestamp >= startYesterday) return "Yesterday";
  if (timestamp >= startSevenDays) return "Previous 7 Days";
  return "Older";
}

function normalizeSavedMessage(message) {
  return {
    id: message.id || makeId("message"),
    role: message.role === "assistant" ? "assistant" : "user",
    content: typeof message.content === "string"
      ? message.content
      : typeof message.text === "string"
        ? message.text
        : "",
    timestamp: Number(message.timestamp) || Date.now(),
    chunks: Array.isArray(message.chunks)
      ? message.chunks
      : Array.isArray(message.matchedChunks)
        ? message.matchedChunks
        : undefined,
    rewrittenQuery: message.rewrittenQuery || null,
    modelUsed: message.modelUsed || null,
    isWelcome: Boolean(message.isWelcome),
    isChitchat: Boolean(message.isChitchat),
  };
}

function SidebarIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path strokeLinecap="round" d="M4 5h16M4 12h16M4 19h16" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4h8v2m-9 0l1 14h8l1-14M10 10v6m4-6v6" />
    </svg>
  );
}

export default function HomePage() {
  const [indexStatus, setIndexStatus] = useState(null);
  const [isSyncingPolicy, setIsSyncingPolicy] = useState(true);
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [ragOpen, setRagOpen] = useState(false);
  const [latestChunks, setLatestChunks] = useState([]);
  const [latestQuestion, setLatestQuestion] = useState("");
  const [rewrittenQuery, setRewrittenQuery] = useState("");
  const [latestIntent, setLatestIntent] = useState("");
  const [questionInput, setQuestionInput] = useState("");
  const [longTermMemory, setLongTermMemory] = useState([]);
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);
  const [memoryToast, setMemoryToast] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [employeeProfile, setEmployeeProfile] = useState(null);
  const [employeeError, setEmployeeError] = useState("");

  const chatEndRef = useRef(null);
  const abortControllerRef = useRef(null);
  const activeReaderRef = useRef(null);
  const questionInputRef = useRef(null);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) || sessions[0] || null,
    [sessions, activeSessionId]
  );
  const messages = activeSession?.messages || [];

  useEffect(() => {
    const cachedEmail =
      window.localStorage.getItem("archemist_chatbot_user_email") || "";
    if (cachedEmail) {
      setUserEmail(cachedEmail);
      setEmailInput(cachedEmail);
    }

    try {
      const saved = JSON.parse(window.localStorage.getItem(CHAT_SESSIONS_KEY) || "[]");
      const savedActiveId = window.localStorage.getItem(ACTIVE_SESSION_KEY);
      const normalized = Array.isArray(saved)
        ? saved
            .filter((session) => session && typeof session.id === "string")
            .map((session) => ({
              id: session.id,
              title: typeof session.title === "string" && session.title.trim()
                ? session.title
                : "New Conversation",
              createdAt: Number(session.createdAt) || Date.now(),
              updatedAt: Number(session.updatedAt) || Date.now(),
              messages: Array.isArray(session.messages)
                ? session.messages.map(normalizeSavedMessage)
                : [createWelcomeMessage()],
            }))
        : [];

      if (normalized.length > 0) {
        const active =
          normalized.find((session) => session.id === savedActiveId) ||
          [...normalized].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        setSessions(normalized);
        setActiveSessionId(active.id);

        const lastAssistant = [...active.messages].reverse().find(
          (message) => message.role === "assistant"
        );
        setLatestChunks(lastAssistant?.chunks || []);
        setRewrittenQuery(lastAssistant?.rewrittenQuery || "");
        setLatestIntent(lastAssistant?.isChitchat ? "CHITCHAT" : "POLICY");
      } else {
        const defaultSession = createSession();
        setSessions([defaultSession]);
        setActiveSessionId(defaultSession.id);
      }
    } catch {
      const defaultSession = createSession();
      setSessions([defaultSession]);
      setActiveSessionId(defaultSession.id);
    }

    try {
      const savedMemory = JSON.parse(
        window.localStorage.getItem("archemist_hr_user_memory") || "[]"
      );
      if (Array.isArray(savedMemory)) {
        setLongTermMemory(savedMemory.filter((fact) => typeof fact === "string"));
      }
    } catch {
      setLongTermMemory([]);
    }
    setIsHydrated(true);

    if (cachedEmail) {
      verifyEmployee(cachedEmail);
    }
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    window.localStorage.setItem("archemist_hr_user_memory", JSON.stringify(longTermMemory));
  }, [longTermMemory, isHydrated]);

  useEffect(() => {
    if (!isHydrated || isStreaming) return;
    window.localStorage.setItem(CHAT_SESSIONS_KEY, JSON.stringify(sessions));
    if (activeSessionId) {
      window.localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId);
    }
  }, [sessions, activeSessionId, isHydrated, isStreaming]);

  useEffect(() => {
    let active = true;
    async function loadBackendPolicy() {
      try {
        setIsSyncingPolicy(true);
        const res = await fetch("/api/ingest", { method: "GET" });
        const data = await res.json();
        if (active && res.ok) {
          setIndexStatus({
            status: data.status || "ready",
            totalPages: data.totalPages || 7,
            totalChunks: data.chunkCount ?? data.totalChunks ?? 0,
          });
        }
      } catch (err) {
        console.error("Failed to check backend policy:", err);
      } finally {
        if (active) setIsSyncingPolicy(false);
      }
    }
    loadBackendPolicy();
    return () => active = false;
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isStreaming]);

  async function verifyEmployee(rawEmail) {
    const normalizedEmail = rawEmail.trim().toLowerCase();
    if (!normalizedEmail) return;

    setEmployeeError("");
    try {
      const response = await fetch(
        `/api/history?email=${encodeURIComponent(normalizedEmail)}`
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Employee not authorized.");

      setUserEmail(normalizedEmail);
      setEmployeeProfile(data.employee);
      setEmailInput(normalizedEmail);
      window.localStorage.setItem(
        "archemist_chatbot_user_email",
        normalizedEmail
      );

      const normalizedSessions = (data.sessions || []).map((session) => ({
        id: session.id,
        title: session.title || "New Conversation",
        createdAt: session.created_at
          ? new Date(session.created_at).getTime()
          : Date.now(),
        updatedAt: session.updated_at
          ? new Date(session.updated_at).getTime()
          : Date.now(),
        messages: [createWelcomeMessage()],
      }));
      if (normalizedSessions.length > 0) {
        setSessions(normalizedSessions);
        const savedActiveId = window.localStorage.getItem(ACTIVE_SESSION_KEY);
        const active =
          normalizedSessions.find((session) => session.id === savedActiveId) ||
          normalizedSessions[0];
        setActiveSessionId(active.id);
        await loadSession(active.id, normalizedEmail);
      } else {
        await createServerSession(normalizedEmail);
      }
    } catch (error) {
      setEmployeeProfile(null);
      setEmployeeError(
        error instanceof Error ? error.message : "Employee not authorized."
      );
    }
  }

  async function loadSession(sessionId, email = userEmail) {
    if (!email || !sessionId) return;
    try {
      const response = await fetch(
        `/api/history/session/${encodeURIComponent(sessionId)}?email=${encodeURIComponent(email)}`
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load chat.");

      const hydratedMessages = (data.messages || []).map((message) => ({
        id: message.id,
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content || "",
        timestamp: message.created_at
          ? new Date(message.created_at).getTime()
          : Date.now(),
        chunks: Array.isArray(message.cited_chunks)
          ? message.cited_chunks
          : undefined,
        rewrittenQuery: message.rewritten_query || null,
        modelUsed: message.model_used || null,
        isWelcome: false,
        isChitchat: Boolean(message.is_chitchat),
      }));

      setSessions((previous) =>
        previous.map((session) =>
          session.id === sessionId
            ? {
                ...session,
                title: data.session.title || session.title,
                createdAt: data.session.created_at
                  ? new Date(data.session.created_at).getTime()
                  : session.createdAt,
                updatedAt: data.session.updated_at
                  ? new Date(data.session.updated_at).getTime()
                  : session.updatedAt,
                messages:
                  hydratedMessages.length > 0
                    ? hydratedMessages
                    : [createWelcomeMessage()],
              }
            : session
        )
      );

      const lastAssistant = [...hydratedMessages]
        .reverse()
        .find((message) => message.role === "assistant");
      setLatestChunks(lastAssistant?.chunks || []);
      setRewrittenQuery(lastAssistant?.rewrittenQuery || "");
      setLatestIntent(lastAssistant?.isChitchat ? "CHITCHAT" : "POLICY");
    } catch (error) {
      setEmployeeError(
        error instanceof Error ? error.message : "Could not load chat."
      );
    }
  }

  async function createServerSession(email = userEmail) {
    if (!email) return;
    try {
      const response = await fetch("/api/history/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create chat.");

      const session = {
        id: data.session.id,
        title: data.session.title || "New Conversation",
        createdAt: data.session.created_at
          ? new Date(data.session.created_at).getTime()
          : Date.now(),
        updatedAt: data.session.updated_at
          ? new Date(data.session.updated_at).getTime()
          : Date.now(),
        messages: [createWelcomeMessage()],
      };
      setSessions((previous) => [session, ...previous]);
      setActiveSessionId(session.id);
      window.localStorage.setItem(ACTIVE_SESSION_KEY, session.id);
      setLatestChunks([]);
      setLatestQuestion("");
      setRewrittenQuery("");
      setLatestIntent("");
    } catch (error) {
      setEmployeeError(
        error instanceof Error ? error.message : "Could not create chat."
      );
    }
  }

  function updateActiveSession(updater) {
    setSessions((previous) =>
      previous.map((session) =>
        session.id === activeSessionId
          ? {
              ...session,
              ...updater(session),
              updatedAt: Date.now(),
            }
          : session
      )
    );
  }

  function handleNewChat() {
    if (!userEmail) {
      setEmployeeError("Enter and verify your Archemist email first.");
      return;
    }
    if (activeReaderRef.current) activeReaderRef.current.cancel().catch(() => {});
    if (abortControllerRef.current) abortControllerRef.current.abort();
    activeReaderRef.current = null;
    abortControllerRef.current = null;
    setIsStreaming(false);
    createServerSession(userEmail);
    setQuestionInput("");
  }

  function switchSession(sessionId) {
    if (isStreaming) {
      if (activeReaderRef.current) activeReaderRef.current.cancel().catch(() => {});
      if (abortControllerRef.current) abortControllerRef.current.abort();
      activeReaderRef.current = null;
      abortControllerRef.current = null;
      setIsStreaming(false);
    }

    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    setActiveSessionId(sessionId);
    window.localStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
    if (userEmail) loadSession(sessionId, userEmail);
    const lastAssistant = [...session.messages].reverse().find(
      (message) => message.role === "assistant"
    );
    setLatestChunks(lastAssistant?.chunks || []);
    setLatestQuestion("");
    setRewrittenQuery(lastAssistant?.rewrittenQuery || "");
    setLatestIntent(lastAssistant?.isChitchat ? "CHITCHAT" : "POLICY");
    setQuestionInput("");
  }

  function deleteSession(sessionId) {
    if (!userEmail) return;
    fetch(
      `/api/history/session/${encodeURIComponent(sessionId)}?email=${encodeURIComponent(userEmail)}`,
      { method: "DELETE" }
    ).catch(() => {});

    setSessions((previous) => {
      const remaining = previous.filter((session) => session.id !== sessionId);
      if (sessionId !== activeSessionId) return remaining;

      if (remaining.length > 0) {
        const next = [...remaining].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        setActiveSessionId(next.id);
        const lastAssistant = [...next.messages].reverse().find(
          (message) => message.role === "assistant"
        );
        setLatestChunks(lastAssistant?.chunks || []);
        setRewrittenQuery(lastAssistant?.rewrittenQuery || "");
        setLatestIntent(lastAssistant?.isChitchat ? "CHITCHAT" : "POLICY");
      } else {
        const next = createSession();
        setActiveSessionId(next.id);
        setLatestChunks([]);
        setLatestQuestion("");
        setRewrittenQuery("");
        setLatestIntent("");
        return [next];
      }
      return remaining;
    });
  }

  function clearAllHistory() {
    if (!window.confirm("Clear all chat history?")) return;
    if (activeReaderRef.current) activeReaderRef.current.cancel().catch(() => {});
    if (abortControllerRef.current) abortControllerRef.current.abort();
    activeReaderRef.current = null;
    abortControllerRef.current = null;
    setIsStreaming(false);
    const newSession = createSession();
    setSessions([newSession]);
    setActiveSessionId(newSession.id);
    setLatestChunks([]);
    setLatestQuestion("");
    setRewrittenQuery("");
    setLatestIntent("");
  }

  async function handlePauseSearch() {
    if (activeReaderRef.current) {
      try {
        await activeReaderRef.current.cancel();
      } catch {}
      activeReaderRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
    updateActiveSession((session) => {
      const last = session.messages[session.messages.length - 1];
      const updatedMessages = [...session.messages];
      if (last?.role === "assistant") {
        updatedMessages[updatedMessages.length - 1] = {
          ...last,
          content: last.content
            ? `${last.content}\n\n[Generation paused — feel free to ask a different question.]`
            : "Response paused. Feel free to ask a different HR policy question.",
          timestamp: Date.now(),
          isStreaming: false,
        };
      }
      return { messages: updatedMessages };
    });
    setTimeout(() => questionInputRef.current?.focus(), 50);
  }

  function removeMemoryFact(factToRemove) {
    setLongTermMemory((previous) => previous.filter((fact) => fact !== factToRemove));
  }

  async function submitQuestion(rawQuestion) {
    const trimmed = rawQuestion.trim();
    if (!trimmed || !activeSessionId) return;

    if (activeReaderRef.current) {
      try {
        await activeReaderRef.current.cancel();
      } catch {}
      activeReaderRef.current = null;
    }
    if (abortControllerRef.current) abortControllerRef.current.abort();

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const timestamp = Date.now();
    const userMessage = {
      id: makeId("user"),
      role: "user",
      content: trimmed,
      timestamp,
    };
    const assistantMessageId = makeId("assistant");
    const placeholderAssistant = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      timestamp,
      chunks: undefined,
      rewrittenQuery: null,
      modelUsed: null,
      isStreaming: true,
    };

    updateActiveSession((session) => ({
      messages: [...session.messages, userMessage, placeholderAssistant],
    }));
    setQuestionInput("");
    setIsStreaming(true);
    setLatestQuestion(trimmed);
    setLatestChunks([]);

    const processNdjsonLine = (line) => {
      const cleanLine = line.trim();
      if (!cleanLine) return;
      let event;
      try {
        event = JSON.parse(cleanLine);
      } catch {
        return;
      }

      if (event.type === "sources") {
        const chunks = Array.isArray(event.chunks) ? event.chunks : [];
        const rewritten = event.rewrittenQuery && event.rewrittenQuery !== trimmed
          ? event.rewrittenQuery
          : null;
        setLatestChunks(chunks);
        setLatestIntent(event.intent || "");
        setRewrittenQuery(rewritten || "");

        if (typeof event.newMemoryFact === "string" && event.newMemoryFact.trim()) {
          const fact = event.newMemoryFact.trim();
          setLongTermMemory((previous) =>
            previous.some((item) => item.toLowerCase() === fact.toLowerCase())
              ? previous
              : [...previous, fact]
          );
          setMemoryToast("Memory updated");
          window.setTimeout(() => setMemoryToast(""), 2200);
        }

        setSessions((previous) =>
          previous.map((session) => {
            if (session.id !== activeSessionId) return session;
            const shouldTitle =
              event.intent === "POLICY" && session.title === "New Conversation";
            return {
              ...session,
              title: shouldTitle ? cleanTitle(trimmed) : session.title,
              updatedAt: Date.now(),
              messages: session.messages.map((message) =>
                message.id === assistantMessageId
                  ? {
                      ...message,
                      chunks,
                      rewrittenQuery: rewritten,
                      modelUsed: event.modelUsed || null,
                      isChitchat: event.intent === "CHITCHAT",
                    }
                  : message
              ),
            };
          })
        );
      } else if (event.type === "text") {
        const token = event.content || "";
        if (!token) return;
        setSessions((previous) =>
          previous.map((session) =>
            session.id === activeSessionId
              ? {
                  ...session,
                  updatedAt: Date.now(),
                  messages: session.messages.map((message) =>
                    message.id === assistantMessageId
                      ? { ...message, content: message.content + token }
                      : message
                  ),
                }
              : session
          )
        );
      } else if (event.type === "error") {
        setSessions((previous) =>
          previous.map((session) =>
            session.id === activeSessionId
              ? {
                  ...session,
                  updatedAt: Date.now(),
                  messages: session.messages.map((message) =>
                    message.id === assistantMessageId
                      ? {
                          ...message,
                          content: event.content || "Something went wrong while searching the policy.",
                          isStreaming: false,
                          isError: true,
                        }
                      : message
                  ),
                }
              : session
          )
        );
      }
    };

    try {
      const historySession = activeSession;
      const history = (historySession?.messages || [])
        .filter((message) => message.content && !message.isStreaming)
        .slice(-12)
        .map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          matchedChunks: message.chunks ?? null,
          intent: message.isChitchat ? "CHITCHAT" : "POLICY",
        }));
      const fullMessages = [
        ...history,
        { role: "user", content: trimmed },
      ];

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          messages: fullMessages,
          history,
          longTermMemory,
          userEmail,
          sessionId: activeSessionId,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        let errorMsg = "Failed to get answer from HR assistant.";
        try {
          const errorData = await res.json();
          if (errorData?.error) errorMsg = errorData.error;
        } catch {}
        throw new Error(errorMsg);
      }
      if (!res.body) throw new Error("ReadableStream is not available in this response.");

      const reader = res.body.getReader();
      activeReaderRef.current = reader;
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) processNdjsonLine(line);
      }
      buffer += decoder.decode();
      if (buffer.trim()) processNdjsonLine(buffer);

      setSessions((previous) =>
        previous.map((session) =>
          session.id === activeSessionId
            ? {
                ...session,
                updatedAt: Date.now(),
                messages: session.messages.map((message) =>
                  message.id === assistantMessageId
                    ? {
                        ...message,
                        isStreaming: false,
                        content: message.content ||
                          "The current policy document does not specify this.",
                      }
                    : message
                ),
              }
            : session
        )
      );
    } catch (err) {
      if (err?.name === "AbortError" || controller.signal.aborted) return;
      setSessions((previous) =>
        previous.map((session) =>
          session.id === activeSessionId
            ? {
                ...session,
                updatedAt: Date.now(),
                messages: session.messages.map((message) =>
                  message.id === assistantMessageId
                    ? {
                        ...message,
                        isError: true,
                        isStreaming: false,
                        content: err.message || "Something went wrong while searching the policy.",
                      }
                    : message
                ),
              }
            : session
        )
      );
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
        activeReaderRef.current = null;
        setIsStreaming(false);
      }
    }
  }

  const sortedSessions = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  const groupedSessions = sortedSessions.reduce((groups, session) => {
    const group = getHistoryGroup(session.updatedAt);
    if (!groups[group]) groups[group] = [];
    groups[group].push(session);
    return groups;
  }, {});

  function inspectTurn(messageIndex) {
    const message = messages[messageIndex];
    if (!message) return;
    const previousUser = [...messages.slice(0, messageIndex)]
      .reverse()
      .find((item) => item.role === "user");
    setLatestQuestion(previousUser?.content || "");
    setLatestChunks(Array.isArray(message.chunks) ? message.chunks : []);
    setRewrittenQuery(message.rewrittenQuery || "");
    setLatestIntent(message.isChitchat ? "CHITCHAT" : "POLICY");
    setRagOpen(true);
  }

  return (
    <div className="h-dvh w-screen overflow-hidden bg-[#F8FAFC] text-slate-800 flex flex-col">
      <header className="relative shrink-0 bg-[#3D428B] text-white shadow-sm z-30">
        <div className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen((open) => !open)}
              className="h-9 w-9 shrink-0 rounded-lg border border-white/25 bg-white/10 flex items-center justify-center hover:bg-white/20"
              aria-label="Toggle chat history"
            >
              <SidebarIcon />
            </button>
            <div className="h-8 w-8 shrink-0 rounded-lg bg-white/15 flex items-center justify-center font-bold text-sm">HR</div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-semibold tracking-tight leading-tight truncate">
                HR Policy RAG Chatbot
              </h1>
              <p className="hidden sm:block text-[11px] text-indigo-100/90">
                Hybrid Section-Aware Retrieval &bull; Real-Time Streaming
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                verifyEmployee(emailInput);
              }}
              className="hidden md:flex items-center gap-1.5"
            >
              {employeeProfile ? (
                <div className="flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5">
                  <span className="max-w-32 truncate text-xs font-semibold">
                    {employeeProfile.full_name}
                  </span>
                  {employeeProfile.department && (
                    <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium capitalize">
                      {employeeProfile.department}
                    </span>
                  )}
                </div>
              ) : (
                <>
                  <input
                    type="email"
                    value={emailInput}
                    onChange={(event) => setEmailInput(event.target.value)}
                    placeholder="email@archemist.com"
                    className="w-44 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs text-white placeholder:text-indigo-100/70 outline-none"
                  />
                  <button
                    type="submit"
                    className="rounded-full border border-white/25 bg-white px-3 py-1.5 text-xs font-semibold text-[#3D428B]"
                  >
                    Verify
                  </button>
                </>
              )}
            </form>
            <button
              type="button"
              onClick={() => setIsMemoryOpen((open) => !open)}
              className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
            >
              Memory ({longTermMemory.length})
            </button>
            <button
              type="button"
              onClick={() => setRagOpen((open) => !open)}
              className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
            >
              Inspect Sources
            </button>
          </div>
        </div>

        {isMemoryOpen && (
          <div className="absolute right-4 top-14 z-50 w-[320px] rounded-xl border border-stone-200 bg-white p-3 text-stone-800 shadow-xl">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#3D428B]">Saved Memory</h3>
              {longTermMemory.length > 0 && (
                <button type="button" onClick={() => setLongTermMemory([])} className="text-xs font-medium text-red-600">
                  Clear all
                </button>
              )}
            </div>
            {longTermMemory.length === 0 ? (
              <p className="text-xs text-stone-500">No saved user facts yet.</p>
            ) : (
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {longTermMemory.map((fact) => (
                  <div key={fact} className="flex items-start gap-2 rounded-lg bg-[#F7F6F2] px-2.5 py-2">
                    <span className="flex-1 text-xs leading-relaxed">{fact}</span>
                    <button type="button" onClick={() => removeMemoryFact(fact)} className="text-xs font-bold text-stone-400 hover:text-red-600" aria-label={`Remove ${fact}`}>x</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {memoryToast && (
          <div className="absolute right-4 top-14 z-40 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-lg">
            {memoryToast}
          </div>
        )}
      </header>

      <main className="flex-1 min-h-0 flex overflow-hidden">
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-slate-900/30 lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}
        <aside
          className={`${sidebarOpen ? "translate-x-0" : "-translate-x-full"} fixed lg:relative z-50 lg:z-20 h-[calc(100dvh-64px)] lg:h-full w-[260px] shrink-0 border-r border-[#E2E8F0] bg-[#F8FAFC] transition-transform duration-200 flex flex-col`}
        >
          <div className="p-3 border-b border-[#E2E8F0]">
            <button
              type="button"
              onClick={handleNewChat}
              className="w-full rounded-lg bg-[#3D428B] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#313673] flex items-center justify-center gap-2"
            >
              <span className="text-lg leading-none">+</span>
              New Chat
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-2 py-3">
            {["Today", "Yesterday", "Previous 7 Days", "Older"].map((group) =>
              (groupedSessions[group] || []).length > 0 ? (
                <div key={group} className="mb-4">
                  <p className="px-2 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">{group}</p>
                  <div className="space-y-1">
                    {groupedSessions[group].map((session) => (
                      <button
                        key={session.id}
                        type="button"
                        onClick={() => switchSession(session.id)}
                        className={`group w-full rounded-lg px-2.5 py-2 text-left flex items-center gap-2 ${
                          session.id === activeSessionId
                            ? "bg-[#EEF2FF] text-[#3D428B]"
                            : "text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{session.title}</p>
                          <p className={`mt-0.5 text-[10px] ${session.id === activeSessionId ? "text-indigo-500" : "text-slate-400"}`}>
                            {formatRelativeTime(session.updatedAt)}
                          </p>
                        </div>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteSession(session.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.stopPropagation();
                              deleteSession(session.id);
                            }
                          }}
                          className="hidden group-hover:block shrink-0 p-1 text-slate-400 hover:text-red-600"
                          aria-label={`Delete ${session.title}`}
                        >
                          <TrashIcon />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null
            )}
          </div>

          <div className="border-t border-[#E2E8F0] p-3">
            <button
              type="button"
              onClick={clearAllHistory}
              className="w-full rounded-lg px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-red-600"
            >
              Clear All History
            </button>
          </div>
        </aside>

        <section className="flex-1 min-w-0 h-full flex flex-col bg-white">
          <div className="shrink-0 px-5 py-3 border-b border-stone-200 flex items-center justify-between bg-[#3D428B]/5">
            <div className="min-w-0">
              <h2 className="truncate text-sm sm:text-base font-semibold text-[#3D428B]">
                {activeSession?.title || "HR Policy Assistant"}
              </h2>
              <p className="text-xs text-stone-500">Grounded policy answers &bull; Real-time stream</p>
            </div>
            <span className="hidden sm:inline text-xs font-medium text-stone-500 bg-white px-3 py-1 rounded-full border border-stone-200">
              Top-K = 5 &bull; Min Score = 0.35
            </span>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4 bg-[#F7F6F2]/40">
            {messages.map((msg, messageIndex) => {
              const isUser = msg.role === "user";
              if (!isUser && msg.isStreaming && !msg.content) return null;
              return (
                <div key={msg.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-xs ${
                    isUser
                      ? "bg-[#3D428B] text-white rounded-br-sm"
                      : msg.isError
                        ? "bg-red-50 text-red-800 border border-red-200 rounded-bl-sm"
                        : "bg-white text-stone-800 border border-stone-200/90 rounded-bl-sm"
                  }`}>
                    <div className="flex items-center justify-between gap-4 mb-1">
                      <span className={`text-[11px] font-semibold uppercase tracking-wider ${
                        isUser ? "text-indigo-200" : msg.isError ? "text-red-600" : "text-[#3D428B]"
                      }`}>
                        {isUser ? "You" : "HR Policy Bot"}
                      </span>
                      {!isUser && Array.isArray(msg.chunks) && (
                        <button
                          type="button"
                          onClick={() => inspectTurn(messageIndex)}
                          className="text-[11px] font-medium text-[#D07A1E] hover:underline cursor-pointer"
                          title="Inspect chunks used for this response"
                        >
                          {msg.chunks.length} chunk{msg.chunks.length === 1 ? "" : "s"} cited
                        </button>
                      )}
                    </div>
                    {isUser
                      ? <div className="whitespace-pre-wrap">{msg.content}</div>
                      : renderMessageText(msg.content)}
                  </div>
                </div>
              );
            })}

            {isStreaming && (
              <div className="flex justify-start">
                <div className="bg-white border border-stone-200 rounded-2xl rounded-bl-sm px-4 py-2.5 shadow-xs flex items-center gap-3 text-sm text-stone-600">
                  <span className="h-4 w-4 border-2 border-[#3D428B] border-t-transparent rounded-full animate-spin" />
                  <span className="font-medium text-[#3D428B]">Searching HR policy...</span>
                  <button type="button" onClick={handlePauseSearch} className="ml-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-50 hover:bg-amber-100 text-[#D07A1E] border border-[#D07A1E]/30">
                    Pause
                  </button>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="shrink-0 p-3.5 bg-white border-t border-stone-200 space-y-2.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 mr-1">Quick Ask:</span>
              {SAMPLE_QUESTIONS.map((sample) => (
                <button
                  key={sample}
                  type="button"
                  onClick={() => submitQuestion(sample)}
                  className="text-xs px-3 py-1 rounded-full bg-[#F7F6F2] hover:bg-indigo-50 text-stone-700 hover:text-[#3D428B] border border-stone-200 hover:border-[#3D428B]/30"
                >
                  {sample}
                </button>
              ))}
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submitQuestion(questionInput);
              }}
              className="flex items-center gap-2.5"
            >
              <input
                ref={questionInputRef}
                type="text"
                value={questionInput}
                onChange={(event) => setQuestionInput(event.target.value)}
                placeholder="Ask an HR policy question..."
                className="flex-1 min-w-0 rounded-xl border border-stone-300 bg-[#F7F6F2]/50 px-4 py-2.5 text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-[#3D428B] focus:bg-white"
              />
              {isStreaming && (
                <button type="button" onClick={handlePauseSearch} className="px-3 py-2.5 rounded-xl bg-[#D07A1E] text-white text-sm font-medium">
                  Pause
                </button>
              )}
              <button
                type="submit"
                disabled={!questionInput.trim()}
                className="px-5 py-2.5 rounded-xl bg-[#3D428B] hover:bg-[#313673] text-white font-medium text-sm disabled:opacity-50"
              >
                Ask Policy
              </button>
            </form>
          </div>
        </section>

        {ragOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-slate-900/20 lg:hidden"
              onClick={() => setRagOpen(false)}
              aria-hidden="true"
            />
            <aside className="fixed right-0 top-[64px] bottom-0 z-50 w-[360px] max-w-[92vw] border-l border-[#E2E8F0] bg-white lg:relative lg:top-auto lg:w-[360px] lg:z-20 shrink-0 p-4 flex flex-col">
              <div className="shrink-0 flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-[#3D428B]">Retrieved PDF Chunks</h2>
                <button type="button" onClick={() => setRagOpen(false)} className="text-lg leading-none text-slate-400 hover:text-slate-700" aria-label="Close RAG Inspector">×</button>
              </div>
              {latestQuestion && (
                <div className="shrink-0 mb-2 space-y-0.5">
                  <p className="text-xs text-stone-500 truncate">Query: <span className="font-medium text-stone-700">&ldquo;{latestQuestion}&rdquo;</span></p>
                  {rewrittenQuery && <p className="text-xs text-[#3D428B] truncate">Rewritten: &ldquo;{rewrittenQuery}&rdquo;</p>}
                </div>
              )}
              <div className="flex-1 min-h-0 overflow-y-auto space-y-2.5 pr-1">
                {latestChunks.length === 0 ? (
                  <div className="h-full min-h-32 flex items-center justify-center text-center rounded-xl bg-[#F8FAFC] border border-dashed border-[#E2E8F0] px-4">
                    <p className="text-xs text-stone-500">
                      {latestIntent === "CHITCHAT"
                        ? "Conversational Mode — no policy retrieval performed."
                        : "No saved policy chunks for this turn."}
                    </p>
                  </div>
                ) : latestChunks.map((chunk, index) => {
                  const similarityPercent = chunk.matchPercent !== undefined
                    ? Number(chunk.matchPercent).toFixed(1)
                    : chunk.score !== undefined
                      ? (Number(chunk.score) * 100).toFixed(1)
                      : null;
                  return (
                    <div key={chunk.id || index} className="rounded-xl border border-stone-200 bg-[#F8FAFC] p-3">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-semibold text-[#3D428B]">#{index + 1} {chunk.id}</span>
                        {similarityPercent && (
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-amber-100 text-[#D07A1E]">
                            {similarityPercent}% match
                          </span>
                        )}
                      </div>
                      {chunk.section && <p className="text-[11px] font-semibold text-[#3D428B]/80 mb-1 truncate">Section: {chunk.section}</p>}
                      <p className="text-xs text-stone-700 leading-relaxed whitespace-pre-wrap">{chunk.text}</p>
                    </div>
                  );
                })}
              </div>
            </aside>
          </>
        )}
      </main>
    </div>
  );
}
