"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const CHAT_SESSIONS_KEY = "archemist_hr_chat_sessions_v1";
const ACTIVE_SESSION_KEY = "archemist_hr_active_session_id";
const USER_MEMORY_KEY = "archemist_hr_user_memory";

const SAMPLE_QUESTIONS = [
  "What are the official shift timings?",
  "How does the leave approval workflow work?",
  "What happens when I close my browser tab?",
  "How do I onboard an employee?",
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
    content: "Hello again! How can I help?",
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

function hasUserMessages(session) {
  return Boolean(
    session?.messages?.some((message) => message.role === "user")
  );
}

function stripSectionCitations(text) {
  if (!text) return "";
  return text
    .replace(/\s*\[Section\s*\d*[^\]]*\]/gi, "")
    .replace(/\s*\(Section\s*\d+[^)]*\)/gi, "")
    .replace(
      /The current policy document does not specify this\.?/gi,
      "I don't have that specific detail in our current HR & Operations guidelines. Feel free to ask me about something else !"
    );
}

function renderInlineFormatting(line) {
  const cleanedLine = stripSectionCitations(line);
  const parts = cleanedLine.split(/(\*\*.*?\*\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-[#0F1B3D]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 mx-0.5 rounded bg-slate-100 text-[#3D428B] font-mono text-[12px] border border-slate-200/80"
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
            <div key={i} className="flex items-start gap-2 pl-0.5">
              <span className="text-[#636899] font-bold select-none">&bull;</span>
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
  return new Date(timestamp).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function normalizeSavedMessage(message) {
  return {
    id: message.id || makeId("message"),
    role: message.role === "assistant" ? "assistant" : "user",
    content:
      typeof message.content === "string"
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

function AgentAvatar({ className = "w-11 h-11" }) {
  return (
    <div
      className={`${className} relative rounded-full overflow-hidden bg-gradient-to-b from-slate-200 to-slate-300 flex items-center justify-center shrink-0 select-none`}
    >
      <svg
        viewBox="0 0 64 64"
        className="w-full h-full"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E2E8F0" />
            <stop offset="100%" stopColor="#CBD5E1" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" fill="url(#bgGrad)" />
        {/* Suit shoulders */}
        <path
          d="M10 64 C12 47, 52 47, 54 64 Z"
          fill="#1E293B"
        />
        {/* White shirt & tie */}
        <polygon points="27,48 37,48 32,60" fill="#FFFFFF" />
        <polygon points="31,51 33,51 33.5,62 30.5,62" fill="#3B82F6" />
        {/* Neck */}
        <rect x="28" y="38" width="8" height="11" rx="3" fill="#E0AC8B" />
        {/* Head */}
        <ellipse cx="32" cy="28" rx="11" ry="13" fill="#ECC0A1" />
        {/* Hair */}
        <path
          d="M21 25 C20 14, 44 13, 43 25 C41 19, 36 17, 29 18 C24 18, 22 21, 21 25 Z"
          fill="#3B281E"
        />
        {/* Beard/Smile */}
        <path
          d="M23 31 C24 40, 40 40, 41 31 C40 36, 36 39, 32 39 C28 39, 24 36, 23 31 Z"
          fill="#4A3427"
          opacity="0.7"
        />
        <path
          d="M28.5 34 Q32 36.8 35.5 34"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        {/* Eyes */}
        <circle cx="28" cy="27" r="1.4" fill="#1E293B" />
        <circle cx="36" cy="27" r="1.4" fill="#1E293B" />
      </svg>
    </div>
  );
}

export default function HomePage() {
  const [isPopoverOpen, setIsPopoverOpen] = useState(true);
  const [activeTab, setActiveTab] = useState("chat"); // "chat" | "history"

  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [questionInput, setQuestionInput] = useState("");
  const [longTermMemory, setLongTermMemory] = useState([]);
  const [userEmail, setUserEmail] = useState("");

  const chatEndRef = useRef(null);
  const abortControllerRef = useRef(null);
  const activeReaderRef = useRef(null);
  const questionInputRef = useRef(null);

  const activeSession = useMemo(
    () =>
      sessions.find((session) => session.id === activeSessionId) ||
      sessions[0] ||
      null,
    [sessions, activeSessionId]
  );
  const messages = activeSession?.messages || [];

  useEffect(() => {
    const cachedEmail =
      window.localStorage.getItem("archemist_chatbot_user_email") || "";
    if (cachedEmail) {
      setUserEmail(cachedEmail);
    }

    try {
      const saved = JSON.parse(
        window.localStorage.getItem(CHAT_SESSIONS_KEY) || "[]"
      );
      const normalized = Array.isArray(saved)
        ? saved
            .filter((session) => session && typeof session.id === "string")
            .map((session) => ({
              id: session.id,
              title:
                typeof session.title === "string" && session.title.trim()
                  ? session.title
                  : "New Conversation",
              createdAt: Number(session.createdAt) || Date.now(),
              updatedAt: Number(session.updatedAt) || Date.now(),
              messages: Array.isArray(session.messages)
                ? session.messages.map(normalizeSavedMessage)
                : [createWelcomeMessage()],
            }))
            .filter(hasUserMessages)
        : [];

      const defaultSession = createSession();
      setSessions([defaultSession, ...normalized]);
      setActiveSessionId(defaultSession.id);
      window.localStorage.setItem(ACTIVE_SESSION_KEY, defaultSession.id);
    } catch {
      const defaultSession = createSession();
      setSessions([defaultSession]);
      setActiveSessionId(defaultSession.id);
    }

    try {
      const savedMemory = JSON.parse(
        window.localStorage.getItem(USER_MEMORY_KEY) || "[]"
      );
      if (Array.isArray(savedMemory)) {
        setLongTermMemory(
          savedMemory.filter((fact) => typeof fact === "string")
        );
      }
    } catch {
      setLongTermMemory([]);
    }

    setIsHydrated(true);

    // Warm up backend vector store cache silently
    fetch("/api/ingest", { method: "GET" }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    window.localStorage.setItem(
      USER_MEMORY_KEY,
      JSON.stringify(longTermMemory)
    );
  }, [longTermMemory, isHydrated]);

  useEffect(() => {
    if (!isHydrated || isStreaming) return;
    window.localStorage.setItem(CHAT_SESSIONS_KEY, JSON.stringify(sessions));
    if (activeSessionId) {
      window.localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId);
    }
  }, [sessions, activeSessionId, isHydrated, isStreaming]);

  useEffect(() => {
    if (activeTab === "chat" && isPopoverOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, isStreaming, activeTab, isPopoverOpen]);

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
    if (activeReaderRef.current) {
      activeReaderRef.current.cancel().catch(() => {});
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    activeReaderRef.current = null;
    abortControllerRef.current = null;
    setIsStreaming(false);

    const newSession = createSession();
    setSessions((previous) => [
      newSession,
      ...previous.filter(hasUserMessages).map((session) => ({
        ...session,
        messages: session.messages.map((message) =>
          message.isStreaming ? { ...message, isStreaming: false } : message
        ),
      })),
    ]);
    setActiveSessionId(newSession.id);
    window.localStorage.setItem(ACTIVE_SESSION_KEY, newSession.id);
    setQuestionInput("");
    setActiveTab("chat");
  }

  function handleOpenChatbot() {
    handleNewChat();
    setIsPopoverOpen(true);
    setTimeout(() => questionInputRef.current?.focus(), 50);
  }

  function switchSession(sessionId) {
    if (isStreaming) {
      if (activeReaderRef.current) {
        activeReaderRef.current.cancel().catch(() => {});
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      activeReaderRef.current = null;
      abortControllerRef.current = null;
      setIsStreaming(false);
    }

    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    setActiveSessionId(sessionId);
    window.localStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
    setQuestionInput("");
    setActiveTab("chat");
  }

  function deleteSession(sessionId) {
    if (sessionId === activeSessionId && isStreaming) {
      if (activeReaderRef.current) {
        activeReaderRef.current.cancel().catch(() => {});
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      activeReaderRef.current = null;
      abortControllerRef.current = null;
      setIsStreaming(false);
    }

    setSessions((previous) => {
      const remaining = previous.filter((session) => session.id !== sessionId);
      if (remaining.length === 0) {
        const fresh = createSession();
        setActiveSessionId(fresh.id);
        window.localStorage.setItem(ACTIVE_SESSION_KEY, fresh.id);
        return [fresh];
      }

      if (sessionId === activeSessionId) {
        const next = [...remaining].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        setActiveSessionId(next.id);
        window.localStorage.setItem(ACTIVE_SESSION_KEY, next.id);
      }

      return remaining;
    });
  }

  function clearAllHistory() {
    if (activeReaderRef.current) {
      activeReaderRef.current.cancel().catch(() => {});
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    activeReaderRef.current = null;
    abortControllerRef.current = null;
    setIsStreaming(false);
    const newSession = createSession();
    setSessions([newSession]);
    setActiveSessionId(newSession.id);
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
          content: "paused",
          timestamp: Date.now(),
          isStreaming: false,
        };
      }
      return { messages: updatedMessages };
    });
    setTimeout(() => questionInputRef.current?.focus(), 50);
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
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

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
    setActiveTab("chat");

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
        const rewritten =
          event.rewrittenQuery && event.rewrittenQuery !== trimmed
            ? event.rewrittenQuery
            : null;

        if (
          typeof event.newMemoryFact === "string" &&
          event.newMemoryFact.trim()
        ) {
          const fact = event.newMemoryFact.trim();
          setLongTermMemory((previous) =>
            previous.some((item) => item.toLowerCase() === fact.toLowerCase())
              ? previous
              : [...previous, fact]
          );
        }

        setSessions((previous) =>
          previous.map((session) => {
            if (session.id !== activeSessionId) return session;
            const shouldTitle =
              event.intent === "POLICY" &&
              session.title === "New Conversation";
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
                          content:
                            event.content ||
                            "Something went wrong while searching the policy.",
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
      const fullMessages = [...history, { role: "user", content: trimmed }];

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
      if (!res.body) {
        throw new Error("ReadableStream is not available in this response.");
      }

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
                        content:
                          message.content ||
                          "I don't have that specific detail in our current HR & Operations guidelines. How else can I help?",
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
                        content:
                          err.message ||
                          "Something went wrong while searching the policy.",
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

  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions]
  );

  return (
    <div className="h-dvh w-screen overflow-hidden bg-[#F3F4F9] text-[#0B2149] flex flex-col relative select-none sm:select-auto">
      {/* Top Website Navbar */}
      <header className="shrink-0 h-16 bg-white/95 border-b border-slate-200/70 px-6 sm:px-10 flex items-center justify-between">
        <div className="text-lg font-bold tracking-tight text-[#122652]">
          Your site
        </div>
        <nav className="flex items-center gap-6 sm:gap-9 text-sm font-medium text-[#3B558E]">
          <a href="#home" onClick={(e) => e.preventDefault()} className="hover:text-[#122652] transition-colors">
            Home
          </a>
          <a href="#about" onClick={(e) => e.preventDefault()} className="hover:text-[#122652] transition-colors">
            About
          </a>
          <a href="#blog" onClick={(e) => e.preventDefault()} className="hover:text-[#122652] transition-colors">
            Blog
          </a>
          <a href="#contact" onClick={(e) => e.preventDefault()} className="hover:text-[#122652] transition-colors">
            Contact
          </a>
        </nav>
      </header>

      {/* Main Website Hero Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <h1 className="text-2xl sm:text-[28px] font-bold text-[#0A1F44] tracking-tight">
          Chatbot
        </h1>
        <p className="mt-3 text-sm sm:text-[15px] text-[#4C6299] max-w-md">
          Add an interactive chatbot popover anchored to one side of your website
        </p>
      </main>

      {/* Floating Circular Avatar Launcher (Bottom-Right Corner when Popover is Closed) */}
      {!isPopoverOpen && (
        <button
          type="button"
          onClick={handleOpenChatbot}
          aria-label="Open chatbot"
          className="fixed bottom-5 right-5 z-50 w-16 h-16 rounded-full ring-4 ring-white shadow-[0_10px_30px_rgba(15,23,42,0.24)] hover:scale-105 active:scale-95 transition-transform cursor-pointer overflow-hidden"
        >
          <AgentAvatar className="w-full h-full" />
        </button>
      )}

      {/* Anchored Chatbot Popover Widget */}
      {isPopoverOpen && (
        <section
          aria-label="Personal Assistant Chatbot"
          className="fixed bottom-4 right-4 sm:bottom-5 sm:right-6 z-50 w-[360px] sm:w-[390px] h-[575px] max-h-[calc(100dvh-32px)] max-w-[calc(100vw-24px)] rounded-[24px] bg-white shadow-[0_16px_48px_rgba(15,23,42,0.2)] border border-slate-200/80 flex flex-col overflow-hidden"
        >
          {/* Slate-Indigo Top Header */}
          <div className="relative shrink-0 bg-[#64699A] text-white px-4 pt-3.5 pb-6 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <AgentAvatar className="w-11 h-11 ring-2 ring-white/25" />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-[15px] leading-tight truncate">
                    Rohit
                  </span>
                  <span className="inline-flex items-center justify-center rounded bg-white px-1.5 py-0.5 text-[10px] font-extrabold text-[#555A8B] leading-none">
                    AI
                  </span>
                </div>
                <p className="text-xs text-indigo-100/90 mt-0.5 truncate">
                  Personal Assistant
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Close Popover Button */}
              <button
                type="button"
                onClick={() => setIsPopoverOpen(false)}
                aria-label="Close chatbot"
                className="w-7 h-7 rounded-lg bg-white text-[#1E293B] hover:bg-slate-100 flex items-center justify-center shadow-xs cursor-pointer"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Curved White Inner Body */}
          <div className="relative -mt-3.5 flex-1 min-h-0 rounded-t-[20px] bg-white flex flex-col overflow-hidden">
            {/* TAB 1: CHAT VIEW */}
            {activeTab === "chat" ? (
              <>
                <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-2 space-y-3.5">
                  {messages.map((msg) => {
                    const isUser = msg.role === "user";
                    if (!isUser && msg.isStreaming && !msg.content) {
                      return null;
                    }
                    return (
                      <div
                        key={msg.id}
                        className={`flex ${
                          isUser ? "justify-end" : "justify-start"
                        }`}
                      >
                        {isUser ? (
                          <div className="max-w-[82%] rounded-2xl bg-[#F3F2FA] text-[#1C233B] px-3.5 py-2 text-sm leading-relaxed">
                            <div className="whitespace-pre-wrap">
                              {msg.content}
                            </div>
                          </div>
                        ) : (
                          <div
                            className={`max-w-[92%] text-sm leading-relaxed ${
                              msg.isError
                                ? "rounded-xl bg-red-50 text-red-700 px-3 py-2 border border-red-200"
                                : "text-[#142149]"
                            }`}
                          >
                            {renderMessageText(msg.content)}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Quick-Ask Suggestions when conversation only has the welcome message */}
                  {messages.length <= 1 && !isStreaming && (
                    <div className="pt-2 flex flex-wrap gap-1.5">
                      {SAMPLE_QUESTIONS.map((sample) => (
                        <button
                          key={sample}
                          type="button"
                          onClick={() => submitQuestion(sample)}
                          className="text-left text-[11px] px-2.5 py-1.5 rounded-xl bg-[#F3F4F9] hover:bg-[#E7E9F5] text-[#2B3D70] transition-colors cursor-pointer"
                        >
                          {sample}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Streaming indicator with Pause option */}
                  {isStreaming && (
                    <div className="flex items-center gap-2.5 text-xs text-[#555A8B] py-1">
                      <span className="h-3.5 w-3.5 border-2 border-[#64699A] border-t-transparent rounded-full animate-spin" />
                      <span>Thinking...</span>
                      <button
                        type="button"
                        onClick={handlePauseSearch}
                        className="px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 text-[#1E2B58] font-medium cursor-pointer"
                      >
                        Pause
                      </button>
                    </div>
                  )}

                  <div ref={chatEndRef} />
                </div>

                {/* Pill Input Bar */}
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitQuestion(questionInput);
                  }}
                  className="shrink-0 mx-3 mb-3 px-3.5 py-1.5 rounded-full bg-[#E3E6F0] flex items-center gap-2"
                >
                  <input
                    ref={questionInputRef}
                    type="text"
                    value={questionInput}
                    onChange={(event) => setQuestionInput(event.target.value)}
                    placeholder="Type here"
                    className="flex-1 min-w-0 bg-transparent text-sm text-[#142149] placeholder:text-[#7883A5] focus:outline-none py-1"
                  />

                  {isStreaming ? (
                    <button
                      type="button"
                      onClick={handlePauseSearch}
                      title="Pause response"
                      className="w-8 h-8 rounded-full bg-[#D07A1E] hover:bg-[#b86917] text-white flex items-center justify-center shrink-0 cursor-pointer"
                    >
                      <svg
                        className="w-3.5 h-3.5"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path d="M5.5 3.5A1.5 1.5 0 017 5v10a1.5 1.5 0 01-3 0V5a1.5 1.5 0 011.5-1.5zm9 0A1.5 1.5 0 0116 5v10a1.5 1.5 0 01-3 0V5a1.5 1.5 0 011.5-1.5z" />
                      </svg>
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={!questionInput.trim()}
                      aria-label="Send message"
                      className="w-8 h-8 rounded-full bg-[#0066CC] hover:bg-[#0055B3] disabled:opacity-50 text-white flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 12h14M13 5l7 7-7 7"
                        />
                      </svg>
                    </button>
                  )}
                </form>
              </>
            ) : (
              /* TAB 2: HISTORY VIEW */
              <div className="flex-1 min-h-0 overflow-y-auto px-3.5 pt-3.5 pb-3 space-y-2.5">
                <div className="flex items-center justify-between px-1 mb-1">
                  <span className="text-xs font-semibold text-[#555A8B]">
                    Conversations ({sortedSessions.length})
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleNewChat}
                      className="text-xs font-semibold text-[#0066CC] hover:underline cursor-pointer"
                    >
                      + New Chat
                    </button>
                    <button
                      type="button"
                      onClick={clearAllHistory}
                      className="text-xs font-semibold text-red-600 hover:underline cursor-pointer"
                    >
                      Clear All
                    </button>
                  </div>
                </div>

                {sortedSessions.map((session) => {
                  const isCurrent = session.id === activeSessionId;
                  const lastMsg =
                    session.messages[session.messages.length - 1] ||
                    createWelcomeMessage();
                  const previewText = stripSectionCitations(
                    lastMsg.content || "Hello again! How can I help?"
                  );

                  return (
                    <div
                      key={session.id}
                      onClick={() => switchSession(session.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          switchSession(session.id);
                        }
                      }}
                      className="group rounded-2xl bg-[#ECEDF5] hover:bg-[#E2E4F0] p-3.5 flex items-start gap-3 transition-colors cursor-pointer"
                    >
                      <div className="w-9 h-9 rounded-full bg-[#878CB4] text-white flex items-center justify-center shrink-0 mt-0.5">
                        <svg
                          className="w-4 h-4"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v7a2 2 0 01-2 2H6l-4 4V5z" />
                        </svg>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-bold text-[#142149] truncate">
                            Rohit:
                          </p>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              deleteSession(session.id);
                            }}
                            title="Delete this chat"
                            aria-label="Delete conversation"
                            className="p-1 rounded-md text-[#6D7797] hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer shrink-0"
                          >
                            <svg
                              className="w-3.5 h-3.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M3 6h18M8 6V4h8v2m-9 0l1 14h8l1-14M10 10v6m4-6v6"
                              />
                            </svg>
                          </button>
                        </div>
                        <p className="text-xs text-[#1E2B58] truncate mt-0.5">
                          {previewText}
                        </p>
                        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-medium text-[#47537B]">
                          {isCurrent ? (
                            <>
                              <span className="h-2 w-2 rounded-full bg-[#1C2D5E]" />
                              <span>Current</span>
                            </>
                          ) : (
                            <span>{formatRelativeTime(session.updatedAt)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Bottom Navigation Bar (ONLY 2 Tabs: Chat & History — No Voice) */}
            <div className="shrink-0 grid grid-cols-2 border-t border-slate-200/80 bg-white">
              <button
                type="button"
                onClick={() => setActiveTab("chat")}
                className={`py-2.5 flex flex-col items-center justify-center gap-1 text-xs transition-colors cursor-pointer ${
                  activeTab === "chat"
                    ? "border-t-2 border-[#16234D] text-[#16234D] font-semibold"
                    : "text-[#6D7797] hover:text-[#16234D]"
                }`}
              >
                <svg
                  className="w-4 h-4"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v7a2 2 0 01-2 2H6l-4 4V5z" />
                </svg>
                <span>Chat</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("history")}
                className={`py-2.5 flex flex-col items-center justify-center gap-1 text-xs transition-colors cursor-pointer ${
                  activeTab === "history"
                    ? "border-t-2 border-[#16234D] text-[#16234D] font-semibold"
                    : "text-[#6D7797] hover:text-[#16234D]"
                }`}
              >
                <svg
                  className="w-4 h-4"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-12.25a.75.75 0 00-1.5 0v4.5c0 .414.336.75.75.75h3a.75.75 0 000-1.5h-2.25V5.75z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>History</span>
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
