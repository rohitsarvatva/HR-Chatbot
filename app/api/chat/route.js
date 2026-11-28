import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { searchPolicyChunks } from "@/lib/rag-engine";
import { classifyIntent } from "@/lib/intent-classifier";
import {
  getEmployeeByEmail,
  getSupabaseServerClient,
} from "@/lib/supabaseServer";

const NO_MATCH_FALLBACK =
  "I don't have that specific detail in our current HR & Operations guidelines. Feel free to ask me about something else !";

const SHORT_GREETING_REPLY = "Hello again! How can I help?";

const DEFAULT_CHITCHAT_REPLY =
  "Hello! I'm your HR Policy Assistant. Ask me anything about company leave rules, office timings, work-from-home policies, or reimbursements.";

const GREETING_TOKEN_PATTERN =
  "(?:hi+(?:e+|y[ao]*)?|hy+[ea]*|he+y+(?:a+|o+)?|ha+y+a*|h[aeu]l+o+w*|hl+o+|ello+|ho+l+a+|namast+e+y?|namaskar|yo+|howdy+|greetings?|good\\s+(?:morning|afternoon|evening|day)|morning|afternoon|evening|gm|ga|ge)";

const GREETING_ADDRESSEE_PATTERN =
  "(?:there|rohit|bot|ai|assistant|team|everyone|all|folks|guys|sir|ma'?am|mam|buddy|friend|mate|bro|dude|dear)";

const PURE_GREETING_REGEX = new RegExp(
  `^${GREETING_TOKEN_PATTERN}(?:\\s+(?:${GREETING_TOKEN_PATTERN}|${GREETING_ADDRESSEE_PATTERN}))*$`,
  "i",
);

const LEADING_GREETING_REGEX = new RegExp(
  `^${GREETING_TOKEN_PATTERN}(?:\\s+${GREETING_ADDRESSEE_PATTERN})*\\s+`,
  "i",
);

const BASE_SYSTEM_INSTRUCTION = `You are Rohit, the Archemist Studio OS Assistant — an internal HR & Policy assistant. Answer strictly what the user asked—nothing more, nothing less.

Use these context blocks when answering:
<USER_MEMORY>Saved durable facts about the employee.
</USER_MEMORY>
<CHAT_HISTORY>The recent conversation, used only for continuity and follow-up resolution.
</CHAT_HISTORY>
<POLICY_CONTEXT>Verified excerpts from the HR policy PDF.
</POLICY_CONTEXT>

ADAPTIVE SCOPE & ZERO-FILLER RULES:
1. PROPORTIONAL LENGTH:
   - If the user asks for a specific fact, number, or timing (e.g., "tell about official office timing"), answer in 1–2 crisp sentences.
   - If the user asks for a full policy, list, or multi-step process, cover all necessary steps clearly using concise bullet points.
2. STRICT SCOPE BOUNDARY:
   - Extract ONLY the specific lines from <POLICY_CONTEXT> that directly answer the user's question.
   - Do NOT volunteer adjacent rules, login conditions, penalties, or edge cases unless explicitly asked.
3. ZERO FILLER:
   - Start immediately with the answer. Never use introductory fluff like "Here are the details regarding..." or closing remarks like "Let me know if you need more help."
4. GROUNDING & CONTINUITY:
   - For factual HR policy, workflow, and operational questions, rely EXCLUSIVELY on <POLICY_CONTEXT>. Never invent rules or procedures outside the PDF.
   - Use <USER_MEMORY> and <CHAT_HISTORY> only to resolve pronouns and tailor explanations to the employee's role or context.
   - If a specific policy or operational detail is not found in <POLICY_CONTEXT>, briefly state that you do not have that detail in the current guidelines. Never output the phrase "The current policy document does not specify this."
   - For simple greetings like "hi", "hie", or "hello", reply with "Hello again! How can I help?"
5. FORMATTING:
   - Never mention section numbers, section titles, or bracketed citations.

CONTRASTIVE STYLE EXAMPLES (format only — always use facts exclusively from <POLICY_CONTEXT>):
Example 1 (Narrow fact query):
User: tell about official office timing
Assistant: Official office timings are 09:30 AM to 06:30 PM IST.

Example 2 (Broad policy query):
User: what is our leave policy?
Assistant:
- Casual Leave (CL): For short-notice personal time off.
- Sick Leave (SL): For medical absence and recovery.
- Earned / Paid Leave (EL): Accrued planned leave with advance manager approval.`;

// Use the existing configured chat model for both routing and answer generation.
const CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-3.1-flash-lite";
const ROUTING_MODEL = process.env.GEMINI_ROUTING_MODEL || CHAT_MODEL;

const STREAM_MODELS = [CHAT_MODEL, "gemini-3.5-flash-lite", "gemini-3.8-flash"];

function getChitchatReply(question) {
  const text = question
    .toLowerCase()
    .replace(/[?!.,]+$/g, "")
    .trim();

  const normalized = question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized && PURE_GREETING_REGEX.test(normalized)) {
    return SHORT_GREETING_REPLY;
  }

  const withoutLeadingGreeting = normalized.replace(LEADING_GREETING_REGEX, "");
  const chitchatCandidate =
    withoutLeadingGreeting && withoutLeadingGreeting !== normalized
      ? withoutLeadingGreeting
      : text;

  if (
    /^(how r u|how are u|how are you|how are you doing|how's it going|hows it going|how do you do|whats up|what's up|sup)\b/i.test(
      chitchatCandidate,
    )
  ) {
    return "I'm doing great, thank you for asking! How can I help you today?";
  }

  if (
    /^(who are you|what is your name|what's your name|are you a bot|are you an ai|what can you do|how can you help|help)\b/i.test(
      chitchatCandidate,
    )
  ) {
    return "I'm Rohit, your AI Assistant! I can help you with HR Internal OS . What would you like to know?";
  }

  if (
    /^(thanks|thank you|thx|ty|many thanks|appreciate it)\b/i.test(
      chitchatCandidate,
    )
  ) {
    return "You're welcome! Let me know if there's anything else I can help with.";
  }

  if (
    /^(bye|goodbye|see ya|see you|take care|good night)\b/i.test(
      chitchatCandidate,
    )
  ) {
    return "Goodbye! Have a great day, and feel free to reach out anytime.";
  }

  if (
    /^(ok|okay|got it|understood|cool|nice|great|awesome|alright)\b$/i.test(
      text,
    )
  ) {
    return "Glad I could help!";
  }
  if (/^(I'm Vaibhavi|Im Vaibhavi|vaibhavi)\b$/i.test(text)) {
    return "Get Lost, Dont waste my time ! ";
  }

  return null;
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(
      (message) =>
        (message?.role === "user" || message?.role === "assistant") &&
        (typeof message?.content === "string" ||
          typeof message?.text === "string"),
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
      classifyIntent(message.content).intent === "CHITCHAT";

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
  const stripped = q.replace(
    /^(tell me about|can you explain|please explain|what are|what is|give me)\s+/i,
    "",
  );

  // Only rewrite if it has pronouns, follow-up phrases, or is very short (<= 3 words)
  const hasPronounOrFollowup =
    /\b(it|its|this|that|these|those|they|them|their|he|she|same|above|previous|step \d+|what if|how about|and what)\b/i.test(
      stripped,
    );
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
    .map(
      (message) =>
        `${message.role === "user" ? "Employee" : "Assistant"}: ${message.content}`,
    )
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

function createChitchatStreamResponse({
  text,
  question,
  classifiedIntent,
  newMemoryFact = null,
  supabase,
  employee,
  sessionId,
}) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(
        encoder.encode(
          JSON.stringify({
            type: "sources",
            chunks: [],
            intent: "CHITCHAT",
            classifiedIntent,
            rewrittenQuery: question,
            newMemoryFact,
            modelUsed: null,
          }) + "\n",
        ),
      );
      controller.enqueue(
        encoder.encode(
          JSON.stringify({ type: "text", content: text }) + "\n",
        ),
      );
      if (supabase && employee) {
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
      }
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

export async function POST(request) {
  try {
    const body = await request.json();
    const question = body?.question?.trim();
    const userEmail = String(body?.userEmail || "").trim();
    const sessionId = String(body?.sessionId || "").trim();
    const history = normalizeMessages(
      Array.isArray(body?.messages) ? body.messages : body?.history,
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
        { status: 400 },
      );
    }

    let employee = null;
    let supabase = null;
    const hasSupabaseConfig = Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );

    if (userEmail && sessionId && hasSupabaseConfig) {
      try {
        employee = await getEmployeeByEmail(userEmail);
        supabase = getSupabaseServerClient();

        const { data: ownedSession, error: sessionLookupError } = await supabase
          .from("chatbot_sessions")
          .select("id, title")
          .eq("id", sessionId)
          .eq("user_id", employee.id)
          .maybeSingle();
        if (sessionLookupError || !ownedSession) {
          employee = null;
          supabase = null;
        }
      } catch {
        employee = null;
        supabase = null;
      }
    }

    const { intent, confidence } = classifyIntent(question);
    console.log(
      `[IntentRouter] intent=${intent} confidence=${confidence.toFixed(4)}`,
    );

    if (supabase && employee) {
      await supabase.from("chatbot_messages").insert({
        session_id: sessionId,
        user_id: employee.id,
        role: "user",
        content: question,
        cited_chunks: [],
        rewritten_query: null,
        model_used: null,
        is_chitchat: intent === "CHITCHAT",
      });
    }

    // Fast-Path for CHITCHAT: skip embeddings and vector search completely.
    if (intent === "CHITCHAT") {
      const text = getChitchatReply(question) || DEFAULT_CHITCHAT_REPLY;
      return createChitchatStreamResponse({
        text,
        question,
        classifiedIntent: intent,
        newMemoryFact: null,
        supabase,
        employee,
        sessionId,
      });
    }

    let routedIntent = "POLICY";
    let rewrittenQuery = question;
    let newMemoryFact = null;

    if (needsContextRewrite(question, priorPolicyMessages)) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === "your_api_key_here") {
        throw new Error(
          "Missing or placeholder GEMINI_API_KEY in environment variables (.env.local).",
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

    if (routedIntent === "CHITCHAT") {
      const text = getChitchatReply(question) || DEFAULT_CHITCHAT_REPLY;
      return createChitchatStreamResponse({
        text,
        question,
        classifiedIntent: intent,
        newMemoryFact,
        supabase,
        employee,
        sessionId,
      });
    }

    if (routedIntent === "POLICY" && supabase && employee) {
      const cleanTitle = question
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 40)
        .trim();
      if (cleanTitle) {
        await supabase
          .from("chatbot_sessions")
          .update({ title: cleanTitle, updated_at: new Date().toISOString() })
          .eq("id", sessionId)
          .eq("user_id", employee.id);
      }
    }

    // Hybrid Search: Top-K = 3, minScore = 0.55
    const retrievedChunks = await searchPolicyChunks(rewrittenQuery, 3, 0.55);

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
            classifiedIntent: intent,
            rewrittenQuery,
            newMemoryFact,
            modelUsed: null,
          });

          // 2. Early exit without calling LLM if no chunks matched
          if (matchedChunks.length === 0) {
            const fallbackText = NO_MATCH_FALLBACK;
            enqueueEvent({
              type: "text",
              content: fallbackText,
            });
            if (supabase && employee) {
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
            }
            controller.close();
            return;
          }

          const apiKey = process.env.GEMINI_API_KEY;
          if (!apiKey || apiKey === "your_api_key_here") {
            throw new Error(
              "Missing or placeholder GEMINI_API_KEY in environment variables (.env.local).",
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
                `${message.role === "user" ? "Employee" : "Assistant"}: ${message.content}`,
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
          const department = employee?.department || "general";
          const departmentInstruction = employee
            ? `\n\nEMPLOYEE_CONTEXT:\nName: ${employee.full_name}\nDepartment: ${department}\nTailor workflow examples and role responsibilities to this department while remaining grounded exclusively in <POLICY_CONTEXT>.`
            : "";
          const streamedResult = await openGenerateStreamWithRetry(
            ai,
            prompt,
            `${BASE_SYSTEM_INSTRUCTION}${departmentInstruction}`,
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
              content: NO_MATCH_FALLBACK,
            });
          }

          if (!hasEmittedText) {
            accumulatedText = NO_MATCH_FALLBACK;
          }
          const savedAssistantText = accumulatedText;

          if (supabase && employee) {
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
          }
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
      { status: 500 },
    );
  }
}
