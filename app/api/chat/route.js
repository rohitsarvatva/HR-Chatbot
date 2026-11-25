import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { searchPolicyChunks } from "@/lib/rag-engine";
import { getEmployeeByEmail, getSupabaseServerClient } from "@/lib/supabaseServer";

const BASE_SYSTEM_INSTRUCTION =
  'You are the Archemist Studio OS v1 HR & Operations Assistant.\n\nUse these context blocks when answering:\n<USER_MEMORY>Saved durable facts about the employee.\n</USER_MEMORY>\n<CHAT_HISTORY>The recent conversation, used only for continuity and follow-up resolution.\n</CHAT_HISTORY>\n<POLICY_CONTEXT>Verified excerpts from the HR policy PDF.\n</POLICY_CONTEXT>\n\nRULES:\n1. Respond naturally and politely to greetings, thanks, and meta-questions about what the assistant can do.\n2. Use <USER_MEMORY> and <CHAT_HISTORY> to resolve pronouns and tailor explanations to the employee role or context.\n3. For factual HR policy, workflow, and operational questions, rely EXCLUSIVELY on <POLICY_CONTEXT>. Never invent rules or procedures outside the PDF.\n4. Only output "The current policy document does not specify this." when a specific policy or factual question is genuinely absent from <POLICY_CONTEXT>.\n\nFormatting: Use clear, concise bullet points for multi-part rules. Never mention section numbers, section titles, or bracketed citations.';

// Use the existing configured chat model for both routing and answer generation.
const CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-3.1-flash-lite";
const ROUTING_MODEL =
  process.env.GEMINI_ROUTING_MODEL || CHAT_MODEL;

const STREAM_MODELS = [
  CHAT_MODEL,
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
];

function isGreetingOrChitchat(question) {
  const text = question.toLowerCase().trim();
  return /^(hi|hello|hey|thanks|thank you|thx|ok|okay|good morning)[.! ]*$/i.test(text);
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(
      (message) =>
        (message?.role === "user" || message?.role === "assistant") &&
        (typeof message?.content === "string" || typeof message?.text === "string")
    )
    .slice(-6)
    .map((message) => ({
      role: message.role,
      content: (message.content || message.text || "").trim(),
      id: typeof message?.id === "string" ? message.id : null,
      intent: typeof message?.intent === "string" ? message.intent : null,
      matchedChunks: Array.isArray(message?.matchedChunks)
        ? message.matchedChunks
        : null,
    }))
    .filter((message) => message.content);
}

function buildPriorPolicyMessages(messages) {
  if (!Array.isArray(messages) || messages.length <= 1) return [];

  const priorMessages = messages.slice(0, -1);
  const priorPolicyMessages = [];

  for (let index = 0; index < priorMessages.length; index += 1) {
    const message = priorMessages[index];
    if (message.role !== "user") continue;

    const nextAssistant = priorMessages[index + 1];
    const hasCitedPolicyChunks =
      nextAssistant?.role === "assistant" &&
      Array.isArray(nextAssistant.matchedChunks) &&
      nextAssistant.matchedChunks.length > 0;
    const isChitchat =
      nextAssistant?.intent === "CHITCHAT" ||
      isGreetingOrChitchat(message.content);

    if (!hasCitedPolicyChunks || isChitchat) continue;

    priorPolicyMessages.push({
      role: "user",
      content: message.content,
    });
    priorPolicyMessages.push({
      role: "assistant",
      content: nextAssistant.content,
    });
  }

  return priorPolicyMessages;
}

function needsContextRewrite(latestQuery, priorPolicyMessages) {
  if (priorPolicyMessages.length === 0) return false;

  const q = latestQuery.trim().toLowerCase();
  // Strip polite prefixes like "tell me about", "can you explain", "what is"
  const stripped = q.replace(/^(tell me about|can you explain|please explain|what are|what is|give me)\s+/i, "");

  // Only rewrite if it has pronouns, follow-up phrases, or is very short (<= 3 words)
  const hasPronounOrFollowup = /\b(it|its|this|that|these|those|they|them|their|he|she|same|above|previous|step \d+|what if|how about|and what)\b/i.test(stripped);
  const isVeryShort = stripped.split(/\s+/).length <= 3;

  return hasPronounOrFollowup || isVeryShort;
}

function parseJsonResponse(text) {
  try {
    const cleaned = String(text || "")
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

async function routeAndRewrite(ai, question, chatHistory) {
  const historyText = chatHistory
    .map((message) => `${message.role === "user" ? "Employee" : "Assistant"}: ${message.content}`)
    .join("\n");
  const response = await ai.models.generateContent({
    model: ROUTING_MODEL,
    contents: `Analyze this HR chatbot turn.\n\nRecent conversation:\n${historyText || "(none)"}\n\nLatest employee message:\n${question}\n\nReturn only valid JSON with exactly these fields:\n{"intent":"CHITCHAT"|"POLICY","rewrittenQuery":"standalone search query","newMemoryFact":"concise durable user fact or null"}\n\nRules:\n- CHITCHAT is greeting, pleasantry, thanks, or meta-question.\n- POLICY is any policy, leave, shift, attendance, onboarding, or workflow question.\n- Rewrite pronouns and follow-ups into a standalone vector search query. For CHITCHAT, rewrittenQuery is the latest message.\n- newMemoryFact is durable only for an explicitly shared role, department, location/shift preference, or workflow responsibility. Ignore greetings and one-off policy questions. Return null otherwise.`,
    config: { temperature: 0, responseMimeType: "application/json" },
  });
  const parsed = parseJsonResponse(response?.text);
  if (!parsed) return null;
  return {
    intent: parsed.intent === "CHITCHAT" ? "CHITCHAT" : "POLICY",
    rewrittenQuery:
      typeof parsed.rewrittenQuery === "string" && parsed.rewrittenQuery.trim()
        ? parsed.rewrittenQuery.trim()
        : question,
    newMemoryFact:
      typeof parsed.newMemoryFact === "string" && parsed.newMemoryFact.trim()
        ? parsed.newMemoryFact.trim()
        : null,
  };
}

function formatApiError(error) {
  const raw =
    error?.message || "Failed to process chat request against HR policy.";
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.error?.message) {
      return parsed.error.message;
    }
  } catch {
    // Not a JSON string, return as-is
  }
  return raw;
}

async function openGenerateStreamWithRetry(ai, prompt, systemInstruction) {
  let lastError = null;

  for (const modelName of STREAM_MODELS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const stream = await ai.models.generateContentStream({
          model: modelName,
          contents: prompt,
          config: {
            systemInstruction,
            temperature: 0.1,
          },
        });
        return { stream, modelUsed: modelName };
      } catch (err) {
        lastError = err;
        const msg = String(err?.message || err || "");

        if (
          msg.includes("no longer available") ||
          msg.includes("NOT_FOUND") ||
          msg.includes("INVALID_ARGUMENT")
        ) {
          break;
        }

        const isTransient =
          msg.includes("503") ||
          msg.includes("UNAVAILABLE") ||
          msg.includes("high demand") ||
          msg.includes("429") ||
          msg.includes("RESOURCE_EXHAUSTED");

        if (!isTransient || attempt === 2) {
          break;
        }

        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
  }

  throw lastError;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const question = body?.question?.trim();
    const userEmail = String(body?.userEmail || "").trim();
    const sessionId = String(body?.sessionId || "").trim();
    const history = normalizeMessages(
      Array.isArray(body?.messages) ? body.messages : body?.history
    );
    const priorPolicyMessages = buildPriorPolicyMessages(history);
    const longTermMemory = Array.isArray(body?.longTermMemory)
      ? body.longTermMemory
          .filter((fact) => typeof fact === "string" && fact.trim())
          .slice(-20)
          .map((fact) => fact.trim())
      : [];

    if (!question) {
      return NextResponse.json(
        { error: "Please provide a valid 'question' in the request body." },
        { status: 400 }
      );
    }
    if (!userEmail || !sessionId) {
      return NextResponse.json(
        { error: "Employee email and chat session ID are required." },
        { status: 400 }
      );
    }

    let employee;
    let supabase;
    try {
      employee = await getEmployeeByEmail(userEmail);
      supabase = getSupabaseServerClient();
    } catch (employeeError) {
      const message =
        employeeError instanceof Error
          ? employeeError.message
          : "Employee authorization failed.";
      const status = message.toLowerCase().includes("unauthorized") ? 403 : 400;
      return NextResponse.json({ error: message }, { status });
    }

    const { data: ownedSession, error: sessionLookupError } = await supabase
      .from("chatbot_sessions")
      .select("id, title")
      .eq("id", sessionId)
      .eq("user_id", employee.id)
      .maybeSingle();
    if (sessionLookupError) {
      return NextResponse.json(
        { error: `Session lookup failed: ${sessionLookupError.message}` },
        { status: 400 }
      );
    }
    if (!ownedSession) {
      return NextResponse.json(
        { error: "Unauthorized: chat session not found." },
        { status: 403 }
      );
    }

    const { error: userMessageError } = await supabase
      .from("chatbot_messages")
      .insert({
        session_id: sessionId,
        user_id: employee.id,
        role: "user",
        content: question,
        cited_chunks: [],
        rewritten_query: null,
        model_used: null,
        is_chitchat: false,
      });
    if (userMessageError) {
      return NextResponse.json(
        { error: `Failed to save chat message: ${userMessageError.message}` },
        { status: 400 }
      );
    }

    let routedIntent = "POLICY";
    let rewrittenQuery = question;
    let newMemoryFact = null;

    if (isGreetingOrChitchat(question)) {
      routedIntent = "CHITCHAT";
    } else if (!needsContextRewrite(question, priorPolicyMessages)) {
      routedIntent = "POLICY";
      rewrittenQuery = question;
    } else {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === "your_api_key_here") {
        throw new Error(
          "Missing or placeholder GEMINI_API_KEY in environment variables (.env.local)."
        );
      }
      try {
        const ai = new GoogleGenAI({ apiKey });
        const routing = await routeAndRewrite(ai, question, history.slice(-4));
        if (routing) {
          routedIntent = routing.intent;
          rewrittenQuery = routing.rewrittenQuery;
          newMemoryFact = routing.newMemoryFact;
        }
      } catch (routingError) {
        console.error("Intent routing failed:", routingError);
      }
    }
    if (routedIntent === "POLICY" && ownedSession.title === "New Conversation") {
      const cleanTitle = question.replace(/\s+/g, " ").trim().slice(0, 40).trim();
      if (cleanTitle) {
        await supabase
          .from("chatbot_sessions")
          .update({ title: cleanTitle, updated_at: new Date().toISOString() })
          .eq("id", sessionId)
          .eq("user_id", employee.id);
      }
    }

    if (routedIntent === "CHITCHAT") {
      const text = /^(thanks|thank you|thx)\b/i.test(question)
        ? "You're welcome! How else can I help?"
        : "Hello! I am your Assistant. How can I assist you today?";
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                type: "sources",
                chunks: [],
                intent: "CHITCHAT",
                rewrittenQuery: question,
                newMemoryFact,
                modelUsed: null,
              }) + "\n"
            )
          );
          controller.enqueue(
            encoder.encode(JSON.stringify({ type: "text", content: text }) + "\n")
          );
          await supabase.from("chatbot_messages").insert({
            session_id: sessionId,
            user_id: employee.id,
            role: "assistant",
            content: text,
            cited_chunks: [],
            rewritten_query: question,
            model_used: null,
            is_chitchat: true,
          });
          await supabase
            .from("chatbot_sessions")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", sessionId)
            .eq("user_id", employee.id);
          controller.close();
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    // Hybrid Search: Top-K = 5, minScore = 0.35
    const retrievedChunks = await searchPolicyChunks(rewrittenQuery, 5, 0.35);

    const matchedChunks = retrievedChunks.map((chunk) => ({
      id: chunk.id,
      section: chunk.section,
      score: chunk.score,
      matchPercent: chunk.matchPercent,
      text: chunk.text,
    }));

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const enqueueEvent = (payload) => {
          controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n"));
        };

        try {
          // 1. Immediately stream the retrieved Top-K sources so the RAG Inspector updates instantly
          enqueueEvent({
            type: "sources",
            chunks: matchedChunks,
            intent: "POLICY",
            rewrittenQuery,
            newMemoryFact,
            modelUsed: null,
          });

          // 2. Early exit without calling LLM if no chunks matched
          if (matchedChunks.length === 0) {
            const fallbackText = "The current policy document does not specify this.";
            enqueueEvent({
              type: "text",
              content: fallbackText,
            });
            await supabase.from("chatbot_messages").insert({
              session_id: sessionId,
              user_id: employee.id,
              role: "assistant",
              content: fallbackText,
              cited_chunks: [],
              rewritten_query: rewrittenQuery,
              model_used: null,
              is_chitchat: false,
            });
            await supabase
              .from("chatbot_sessions")
              .update({ updated_at: new Date().toISOString() })
              .eq("id", sessionId)
              .eq("user_id", employee.id);
            controller.close();
            return;
          }

          const apiKey = process.env.GEMINI_API_KEY;
          if (!apiKey || apiKey === "your_api_key_here") {
            throw new Error(
              "Missing or placeholder GEMINI_API_KEY in environment variables (.env.local)."
            );
          }

          const ai = new GoogleGenAI({ apiKey });

          const excerptsText = matchedChunks
            .map((chunk, idx) => {
              const cleanExcerpt = chunk.text
                .replace(/\[Section:\s*[^\]]*\]\s*/gi, "")
                .trim();
              return `Excerpt ${idx + 1}:\n${cleanExcerpt}`;
            })
            .join("\n\n");

          const historyText = history
            .slice(-6)
            .map(
              (message) =>
                `${message.role === "user" ? "Employee" : "Assistant"}: ${message.content}`
            )
            .join("\n");
          const memoryText =
            longTermMemory.length > 0
              ? longTermMemory.map((fact) => `- ${fact}`).join("\n")
              : "(No saved user facts)";
          const prompt =
            `<USER_MEMORY>\n${memoryText}\n</USER_MEMORY>\n\n` +
            `<CHAT_HISTORY>\n${historyText || "(No recent conversation)"}\n</CHAT_HISTORY>\n\n` +
            `<POLICY_CONTEXT>\n${excerptsText}\n</POLICY_CONTEXT>\n\n` +
            `Employee Question: ${rewrittenQuery}`;

          // 3. Stream tokens from fast non-thinking Flash-Lite model
          const department = employee.department || "general";
          const departmentInstruction =
            `\n\nEMPLOYEE_CONTEXT:\nName: ${employee.full_name}\nDepartment: ${department}\n` +
            `Tailor workflow examples and role responsibilities to this department while remaining grounded exclusively in <POLICY_CONTEXT>.`;
          const streamedResult = await openGenerateStreamWithRetry(
            ai,
            prompt,
            `${BASE_SYSTEM_INSTRUCTION}${departmentInstruction}`
          );
          const responseStream = streamedResult.stream;
          const modelUsed = streamedResult.modelUsed;

          let hasEmittedText = false;
          let accumulatedText = "";
          for await (const chunk of responseStream) {
            if (request.signal?.aborted) {
              break;
            }
            const textPiece = chunk?.text;
            if (textPiece) {
              hasEmittedText = true;
              accumulatedText += textPiece;
              enqueueEvent({
                type: "text",
                content: textPiece,
              });
            }
          }

          if (!hasEmittedText && !request.signal?.aborted) {
            enqueueEvent({
              type: "text",
              content: "The current policy document does not specify this.",
            });
          }

          if (!hasEmittedText) {
            accumulatedText = "The current policy document does not specify this.";
          }
          const savedAssistantText = accumulatedText;

          await supabase.from("chatbot_messages").insert({
            session_id: sessionId,
            user_id: employee.id,
            role: "assistant",
            content: savedAssistantText,
            cited_chunks: matchedChunks.map((chunk) => ({
              id: chunk.id,
              score: chunk.score,
            })),
            rewritten_query: rewrittenQuery,
            model_used: modelUsed,
            is_chitchat: false,
          });
          await supabase
            .from("chatbot_sessions")
            .update({ updated_at: new Date().toISOString() })
            .eq("id", sessionId)
            .eq("user_id", employee.id);
          controller.close();
        } catch (streamError) {
          if (!request.signal?.aborted) {
            enqueueEvent({
              type: "error",
              content: formatApiError(streamError),
            });
          }
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Error in /api/chat:", error);
    return NextResponse.json(
      {
        error: formatApiError(error),
      },
      { status: 500 }
    );
  }
}
