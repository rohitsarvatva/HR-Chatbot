import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config();

const VECTOR_STORE_PATH = path.join(process.cwd(), "data", "vector-store.json");
const DATASET_OUTPUT_PATH = path.join(
  process.cwd(),
  "data",
  "intent-dataset.json",
);
const GENERATOR_MODEL = "gemini-3.1-flash-lite";
const TARGET_PER_CLASS = 36;

const CHITCHAT_UTTERANCES = [
  "hi",
  "hie",
  "hello",
  "hey",
  "hey there",
  "hello there",
  "hi rohit",
  "hello assistant",
  "good morning",
  "good afternoon",
  "good evening",
  "good night",
  "gm",
  "namaste",
  "thanks",
  "thank you",
  "thank you so much",
  "thanks a lot",
  "appreciate your help",
  "many thanks",
  "bye",
  "goodbye",
  "see you later",
  "take care",
  "catch you later",
  "who are you",
  "what is your name",
  "what can you do",
  "how can you help me",
  "help me",
  "how are you",
  "how are you doing",
  "how is it going",
  "nice to meet you",
  "okay got it",
  "awesome thanks",
];

const DB_LOOKUP_UTTERANCES = [
  "how many leaves do i have left",
  "check my leave balance",
  "show my attendance",
  "my duty calendar",
  "remaining paid leaves",
  "late marks this month",
  "my attendance record",
  "how many sick leaves are left for me",
  "check my pending leave requests",
  "my attendance summary",
  "show my leave history",
  "how many casual leaves remaining",
  "am i marked late today",
  "my monthly attendance report",
  "check my remaining earned leaves",
  "my login time today",
  "my approved leaves this year",
  "when was my last check in",
  "how many days was i absent this month",
  "what is my current leave balance",
  "show my check in and check out logs",
  "did my leave request get approved",
  "list my upcoming approved leaves",
  "how many half days do i have this month",
  "check my attendance status for yesterday",
  "how many comp offs do i have left",
  "show my shift attendance for this week",
  "how many late arrivals do i have",
  "view my personal attendance calendar",
  "what time did i log in today",
  "how many unpaid leaves have i taken",
  "check my leave status",
  "my total working days this month",
  "show my submitted leave applications",
  "am i present on record today",
  "check my remaining balance for paid time off",
];

const OUT_OF_SCOPE_UTTERANCES = [
  "what is the weather in mumbai today",
  "who won the cricket match yesterday",
  "tell me a funny joke",
  "write a python script to sort a list",
  "what is the current bitcoin price",
  "recommend a good movie to watch tonight",
  "how do i make pasta carbonara",
  "translate bonjour into spanish",
  "who is the prime minister of india",
  "give me stock market tips for tomorrow",
  "book a flight ticket to delhi",
  "what is the capital of australia",
  "solve this quadratic equation for me",
  "write a short poem about rain",
  "best restaurants near bandra west",
  "how many calories are in a banana",
  "explain quantum computing in simple terms",
  "latest football transfer news",
  "how do i fix my wifi router at home",
  "suggest a weekend road trip itinerary",
  "what is the distance from earth to mars",
  "debug my react useeffect infinite loop",
  "convert 100 usd to indian rupees",
  "who directed the movie inception",
  "give me a workout plan for weight loss",
  "what are the top netflix shows right now",
  "summarize the plot of harry potter",
  "how do i train a golden retriever puppy",
  "recommend budget smartphones under 20000",
  "what time is sunset today",
  "write a birthday wish for my best friend",
  "how does photosynthesis work in plants",
  "order pizza online for dinner",
  "play some relaxing jazz music",
  "who invented the telephone",
  "what is the score of the ipl game",
];

const QUESTION_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    shortQuery: {
      type: Type.STRING,
      description:
        "1 short, casual 3 to 5 word employee search query answered by the chunk.",
    },
    naturalQuestion: {
      type: Type.STRING,
      description:
        "1 natural conversational workplace question an employee would ask about this chunk.",
    },
    specificRuleQuestion: {
      type: Type.STRING,
      description:
        "1 specific rule, timing, role, route, or number question directly answered by the chunk.",
    },
  },
  required: ["shortQuery", "naturalQuestion", "specificRuleQuestion"],
};

async function withRetry(fn, maxAttempts = 4, baseDelayMs = 800) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = String(err?.message || err || "");
      const isTransient =
        msg.includes("429") ||
        msg.includes("503") ||
        msg.includes("UNAVAILABLE") ||
        msg.includes("RESOURCE_EXHAUSTED") ||
        msg.includes("high demand");
      if (!isTransient || attempt === maxAttempts) {
        break;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

function cleanQuestion(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function parseJsonObject(rawText) {
  const cleaned = String(rawText || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  return JSON.parse(cleaned);
}

async function generateQuestionsForChunk(ai, chunk) {
  const prompt = `You are generating training utterances for an internal enterprise HR & Operations policy chatbot (Archemist Studio OS v1).

Read this policy manual chunk carefully:
Section: ${chunk.section || "Policy Section"}
Content:
${chunk.text}

Generate exactly 3 realistic, distinct employee questions that this specific chunk directly answers:
1. shortQuery: A short, casual 3-5 word query (e.g., "official office shift timing", "tab close logout rule", "leave approval tiers").
2. naturalQuestion: A natural workplace question an employee would type in chat (e.g., "What happens if I accidentally close my browser tab during work?").
3. specificRuleQuestion: A specific rule, threshold, role, route, or number question grounded in details inside this chunk (e.g., "Which access roles can approve a leave delegation request?").

Rules:
- Do NOT mention "chunk", "PDF", "section number", or "document excerpt".
- Keep each question focused purely on company policy, operations, rules, or workflows (NOT asking for personal user leave balances or personal attendance records).
- Return strictly valid JSON matching the schema.`;

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: GENERATOR_MODEL,
      contents: prompt,
      config: {
        temperature: 0.3,
        responseMimeType: "application/json",
        responseSchema: QUESTION_RESPONSE_SCHEMA,
      },
    }),
  );

  const parsed = parseJsonObject(response?.text);
  return {
    shortQuery: cleanQuestion(parsed?.shortQuery),
    naturalQuestion: cleanQuestion(parsed?.naturalQuestion),
    specificRuleQuestion: cleanQuestion(parsed?.specificRuleQuestion),
  };
}

function dedupeStrings(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const cleaned = cleanQuestion(item);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

/**
 * Selects up to `targetCount` balanced POLICY_RAG questions across all chunks
 * using round-robin sampling over question styles (short -> natural -> specific)
 * so every PDF chunk and every query style is evenly represented.
 */
function sampleBalancedPolicyQuestions(rawByChunk, targetCount) {
  const styleKeys = ["shortQuery", "naturalQuestion", "specificRuleQuestion"];
  const picked = [];
  const seen = new Set();

  // Pass 1..3: rotate style offset per chunk so each chunk contributes diverse styles.
  for (let pass = 0; pass < styleKeys.length && picked.length < targetCount; pass += 1) {
    for (let idx = 0; idx < rawByChunk.length && picked.length < targetCount; idx += 1) {
      const entry = rawByChunk[idx];
      const styleKey = styleKeys[(idx + pass) % styleKeys.length];
      const candidate = cleanQuestion(entry[styleKey]);
      if (!candidate) continue;
      const norm = candidate.toLowerCase();
      if (seen.has(norm)) continue;
      seen.add(norm);
      picked.push(candidate);
    }
  }

  return picked;
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_api_key_here") {
    throw new Error(
      "Missing or placeholder GEMINI_API_KEY. Set it in .env.local before running intent:generate.",
    );
  }

  if (!fs.existsSync(VECTOR_STORE_PATH)) {
    throw new Error(
      `Vector store not found at ${VECTOR_STORE_PATH}. Run "npm run build:index" first.`,
    );
  }

  const chunks = JSON.parse(fs.readFileSync(VECTOR_STORE_PATH, "utf-8"));
  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new Error("data/vector-store.json contains no policy chunks.");
  }

  console.log(
    `Loaded ${chunks.length} chunks from data/vector-store.json. Generating 3 questions/chunk via ${GENERATOR_MODEL}...`,
  );

  const ai = new GoogleGenAI({ apiKey });
  const rawPolicyRagByChunk = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const generated = await generateQuestionsForChunk(ai, chunk);
    rawPolicyRagByChunk.push({
      chunkId: chunk.id,
      section: chunk.section || "Policy Section",
      ...generated,
    });
    console.log(
      `  [${i + 1}/${chunks.length}] ${chunk.id} ->\n    - short:    ${generated.shortQuery}\n    - natural:  ${generated.naturalQuestion}\n    - specific: ${generated.specificRuleQuestion}`,
    );
  }

  const allRawPolicyQuestions = dedupeStrings(
    rawPolicyRagByChunk.flatMap((entry) => [
      entry.shortQuery,
      entry.naturalQuestion,
      entry.specificRuleQuestion,
    ]),
  );

  const chitchatPool = dedupeStrings(CHITCHAT_UTTERANCES);
  const dbLookupPool = dedupeStrings(DB_LOOKUP_UTTERANCES);
  const outOfScopePool = dedupeStrings(OUT_OF_SCOPE_UTTERANCES);

  const balancedSize = Math.min(
    TARGET_PER_CLASS,
    allRawPolicyQuestions.length,
    chitchatPool.length,
    dbLookupPool.length,
    outOfScopePool.length,
  );

  const balancedIntents = {
    POLICY_RAG: sampleBalancedPolicyQuestions(rawPolicyRagByChunk, balancedSize),
    CHITCHAT: chitchatPool.slice(0, balancedSize),
    DB_LOOKUP: dbLookupPool.slice(0, balancedSize),
    OUT_OF_SCOPE: outOfScopePool.slice(0, balancedSize),
  };

  const dataset = {
    metadata: {
      generatedAt: new Date().toISOString(),
      model: GENERATOR_MODEL,
      sourceVectorStore: "data/vector-store.json",
      sourceChunkCount: chunks.length,
      rawPolicyQuestionCount: allRawPolicyQuestions.length,
      samplesPerClass: balancedSize,
      totalBalancedSamples: balancedSize * Object.keys(balancedIntents).length,
    },
    intents: balancedIntents,
    rawPolicyRagByChunk,
  };

  fs.mkdirSync(path.dirname(DATASET_OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(
    DATASET_OUTPUT_PATH,
    JSON.stringify(dataset, null, 2),
    "utf-8",
  );

  console.log(`\nSaved balanced intent dataset to ${DATASET_OUTPUT_PATH}`);
  console.log("Class distribution:");
  for (const [label, list] of Object.entries(balancedIntents)) {
    console.log(`  - ${label.padEnd(14)}: ${list.length} utterances`);
  }
}

main().catch((err) => {
  console.error("Failed to generate intent dataset:", err);
  process.exit(1);
});
