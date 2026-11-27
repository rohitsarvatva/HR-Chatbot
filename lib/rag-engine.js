import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";

const VECTOR_STORE_DIR = path.join(process.cwd(), "data");
const VECTOR_STORE_PATH = path.join(process.cwd(), "data", "vector-store.json");

// Module-level memory caches (persisted across requests in the Node/Vercel serverless instance)
let cachedChunks = null;
const queryEmbeddingCache = new Map();

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "does",
  "for", "from", "had", "has", "have", "how", "i", "if", "in", "into", "is",
  "it", "its", "many", "me", "my", "no", "not", "of", "on", "or", "our",
  "policy", "rules", "should", "so", "such", "that", "the", "their", "them",
  "then", "there", "these", "they", "this", "to", "up", "us", "was", "we",
  "what", "when", "where", "which", "who", "why", "will", "with", "would",
  "you", "your", "archemist", "regarding",
]);

/**
 * Helper to initialize the GoogleGenAI client using GEMINI_API_KEY.
 */
function getGenAIClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_api_key_here") {
    throw new Error(
      "Missing or placeholder GEMINI_API_KEY in environment variables (.env.local)."
    );
  }
  return new GoogleGenAI({ apiKey });
}

/**
 * Retries an async operation with exponential backoff on transient 503 / 429 errors.
 */
async function withRetry(fn, maxAttempts = 4, baseDelayMs = 600) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = String(err?.message || err || "");
      const isTransient =
        msg.includes("503") ||
        msg.includes("UNAVAILABLE") ||
        msg.includes("high demand") ||
        msg.includes("429") ||
        msg.includes("RESOURCE_EXHAUSTED");

      if (!isTransient || attempt === maxAttempts) {
        break;
      }

      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

/**
 * Normalizes custom PDF font Private Use Area glyphs back to standard ASCII punctuation.
 */
export function normalizePdfGlyphs(rawText) {
  if (!rawText || typeof rawText !== "string") return "";
  return rawText
    .replace(/\uE081/g, "(")
    .replace(/\uE082/g, ")")
    .replace(/\uE092/g, ":")
    .replace(/\uE087/g, "@");
}

/**
 * Detects whether a line is a major section or subsection heading in the policy manual.
 */
function detectHeading(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 110) return null;

  if (/^Section\s+\d+\s*:/i.test(trimmed)) {
    return trimmed;
  }
  if (/^\d+\.\s+[A-Z][A-Za-z0-9\s,&/()-]{4,95}$/.test(trimmed)) {
    return trimmed;
  }
  if (
    /^(Document Control & System Overview|Table of Contents|ARCHEMIST STUDIO OS v1)$/i.test(
      trimmed
    )
  ) {
    return trimmed;
  }
  return null;
}

/**
 * Splits a long block into sentence-preserving segments of ~600-900 characters.
 */
function splitBySentences(text, targetSize = 750, maxSize = 900) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  if (cleaned.length <= maxSize) return [cleaned];

  const sentences = cleaned
    .split(/(?<=[.?!])\s+|(?=[●○•]\s+)/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    if (!current) {
      current = sentence;
      continue;
    }

    if (current.length + 1 + sentence.length <= maxSize) {
      current += " " + sentence;
      if (current.length >= targetSize) {
        chunks.push(current.trim());
        current = "";
      }
    } else {
      chunks.push(current.trim());
      current = sentence;
    }
  }

  if (current.trim()) {
    if (
      chunks.length > 0 &&
      current.length < 180 &&
      chunks[chunks.length - 1].length + current.length <= maxSize + 120
    ) {
      chunks[chunks.length - 1] = `${chunks[chunks.length - 1]} ${current.trim()}`;
    } else {
      chunks.push(current.trim());
    }
  }

  return chunks;
}

/**
 * Section & paragraph-aware chunking:
 * Splits by policy section headings and paragraph blocks (\n\n),
 * keeps chunks around 600-900 characters without cutting sentences mid-way,
 * and prepends `[Section: <Heading>]` to each chunk.
 *
 * @param {string} text - Raw PDF text.
 * @param {number} [targetSize=750] - Target character length per chunk.
 * @param {number} [maxSize=900] - Soft maximum character length before splitting on sentence boundary.
 * @returns {string[]} Array of section-prefixed text chunks.
 */
export function chunkText(text, targetSize = 750, maxSize = 900) {
  if (!text || typeof text !== "string") {
    return [];
  }

  const lines = normalizePdfGlyphs(text)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^--\s*\d+\s+of\s+\d+\s*--$/i.test(l) && l !== "None");

  if (lines.length === 0) {
    return [];
  }

  let currentMajorSection = "Overview & Document Control";
  let currentSubSection = "";
  const sections = [];
  let currentParagraphLines = [];

  function getActiveHeading() {
    if (currentSubSection && currentSubSection !== currentMajorSection) {
      return `${currentMajorSection} — ${currentSubSection}`;
    }
    return currentMajorSection;
  }

  function flushParagraph() {
    if (currentParagraphLines.length === 0) return;
    const paragraphText = currentParagraphLines.join(" ").replace(/\s+/g, " ").trim();
    currentParagraphLines = [];
    if (!paragraphText) return;

    sections.push({
      heading: getActiveHeading(),
      text: paragraphText,
    });
  }

  for (const line of lines) {
    const heading = detectHeading(line);
    if (heading) {
      flushParagraph();
      if (/^Section\s+\d+\s*:/i.test(heading)) {
        currentMajorSection = heading;
        currentSubSection = "";
      } else if (/^\d+\.\s+/.test(heading)) {
        currentSubSection = heading;
      } else {
        currentMajorSection = heading;
        currentSubSection = "";
      }
      continue;
    }

    if (/^[●•]\s+/.test(line) && currentParagraphLines.join(" ").length >= 350) {
      flushParagraph();
    }

    currentParagraphLines.push(line);
  }
  flushParagraph();

  const finalChunks = [];
  let accumulatorHeading = null;
  let accumulatorText = "";

  function flushAccumulator() {
    if (!accumulatorText.trim()) return;
    const prefix = `[Section: ${accumulatorHeading}] `;
    const bodyBudget = Math.max(450, maxSize - prefix.length);
    const targetBudget = Math.max(380, targetSize - prefix.length);

    const pieces = splitBySentences(accumulatorText, targetBudget, bodyBudget);
    for (const piece of pieces) {
      finalChunks.push(`${prefix}${piece}`);
    }
    accumulatorText = "";
    accumulatorHeading = null;
  }

  for (const sec of sections) {
    const prefixLen = `[Section: ${sec.heading}] `.length;
    if (!accumulatorHeading) {
      accumulatorHeading = sec.heading;
      accumulatorText = sec.text;
      continue;
    }

    const sameHeading = accumulatorHeading === sec.heading;
    const combinedLen = prefixLen + accumulatorText.length + 1 + sec.text.length;

    if (sameHeading && combinedLen <= maxSize) {
      accumulatorText += " " + sec.text;
    } else if (
      accumulatorText.length + prefixLen < 420 &&
      combinedLen <= maxSize
    ) {
      accumulatorText += ` [${sec.heading}] ${sec.text}`;
    } else {
      flushAccumulator();
      accumulatorHeading = sec.heading;
      accumulatorText = sec.text;
    }
  }
  flushAccumulator();

  return finalChunks;
}

/**
 * Expand short user queries (< 4 words) before embedding so retrieval has richer domain context.
 */
export function expandShortQuery(question) {
  const trimmed = (question || "").trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length > 0 && words.length < 4) {
    return `Archemist HR policy rules regarding: ${trimmed}`;
  }
  return trimmed;
}

/**
 * Calls the Gemini API (gemini-embedding-001) to generate a 768-dimension embedding vector.
 * Uses taskType: "RETRIEVAL_DOCUMENT" for ingestion and "RETRIEVAL_QUERY" for user search.
 * Caches query embeddings in memory for instant repeat/Quick-Ask lookups.
 *
 * @param {string} text - Text to embed.
 * @param {"RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"} [taskType="RETRIEVAL_DOCUMENT"]
 * @returns {Promise<number[]>} 768-dimension vector.
 */
export async function getEmbedding(text, taskType = "RETRIEVAL_DOCUMENT") {
  if (!text || typeof text !== "string" || !text.trim()) {
    throw new Error("getEmbedding requires a non-empty text string.");
  }

  const normalized = text.trim();
  const cacheKey = `${taskType}:${normalized.toLowerCase()}`;

  if (taskType === "RETRIEVAL_QUERY" && queryEmbeddingCache.has(cacheKey)) {
    return queryEmbeddingCache.get(cacheKey);
  }

  const ai = getGenAIClient();
  const response = await withRetry(() =>
    ai.models.embedContent({
      model: "gemini-embedding-001",
      contents: normalized,
      config: {
        taskType,
        outputDimensionality: 768,
      },
    })
  );

  const values =
    response?.embeddings?.[0]?.values ?? response?.embedding?.values;

  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("Failed to obtain embedding vector from Gemini API.");
  }

  if (taskType === "RETRIEVAL_QUERY") {
    queryEmbeddingCache.set(cacheKey, values);
  }

  return values;
}

/**
 * Saves indexed chunk records and their embeddings to data/vector-store.json
 * (used locally by scripts/build-index.js).
 *
 * @param {Array<Object>} records - Array of vector store records to persist.
 */
export function saveVectorStore(records) {
  if (!Array.isArray(records)) {
    throw new Error("saveVectorStore expects an array of records.");
  }

  if (!fs.existsSync(VECTOR_STORE_DIR)) {
    fs.mkdirSync(VECTOR_STORE_DIR, { recursive: true });
  }

  fs.writeFileSync(
    VECTOR_STORE_PATH,
    JSON.stringify(records, null, 2),
    "utf-8"
  );

  cachedChunks = records;
}

/**
 * Reads the pre-built data/vector-store.json from disk once per server lifecycle
 * and caches it in the module-level `cachedChunks` variable.
 *
 * @param {boolean} [forceReload=false] - Force reading from disk even if cached in memory.
 * @returns {Array<Object>} Array of stored records (or empty array if none exist).
 */
export function loadVectorStore(forceReload = false) {
  if (!forceReload && Array.isArray(cachedChunks) && cachedChunks.length > 0) {
    return cachedChunks;
  }

  if (!fs.existsSync(VECTOR_STORE_PATH)) {
    return [];
  }

  try {
    const raw = fs.readFileSync(VECTOR_STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      cachedChunks = parsed;
      return cachedChunks;
    }
    return [];
  } catch (error) {
    console.error("Error reading vector store:", error);
    return [];
  }
}

/**
 * Computes cosine similarity between two equal-length numeric vectors.
 *
 * @param {number[]} vecA
 * @param {number[]} vecB
 * @returns {number} Similarity score in [-1, 1].
 */
export function cosineSimilarity(vecA, vecB) {
  if (
    !Array.isArray(vecA) ||
    !Array.isArray(vecB) ||
    vecA.length === 0 ||
    vecA.length !== vecB.length
  ) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i];
    const b = vecB[i];
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}

/**
 * Computes a lightweight keyword-overlap bonus (up to +0.15) for non-stopword query terms
 * appearing in the candidate chunk text, with mild length normalization for chunks > 400 chars
 * so shorter, exact-answer chunks outrank sprawling multi-rule paragraphs on equal matches.
 */
function computeKeywordOverlapBonus(rawQuestion, chunkTextStr) {
  if (!rawQuestion || !chunkTextStr) return 0;

  const queryTerms = rawQuestion
    .toLowerCase()
    .replace(/[^a-z0-9_/\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));

  if (queryTerms.length === 0) return 0;

  const uniqueTerms = [...new Set(queryTerms)];
  const lowerChunk = chunkTextStr.toLowerCase();

  let matchedCount = 0;
  for (const term of uniqueTerms) {
    if (lowerChunk.includes(term)) {
      matchedCount += 1;
    } else if (term.length >= 5 && lowerChunk.includes(term.slice(0, -1))) {
      matchedCount += 0.8;
    }
  }

  const overlapRatio = Math.min(1, matchedCount / uniqueTerms.length);
  const chunkLength = chunkTextStr.trim().length;
  const lengthFactor =
    chunkLength <= 400 ? 1 : Math.max(0.6, Math.sqrt(400 / chunkLength));
  return Number((overlapRatio * 0.15 * lengthFactor).toFixed(4));
}

/**
 * Hybrid Search against the pre-built data/vector-store.json (cached in memory):
 * - Expands short queries (< 4 words) with "Archemist HR policy rules regarding: "
 * - Embeds query with taskType: "RETRIEVAL_QUERY" (cached in queryEmbeddingCache)
 * - Combines Cosine Similarity with a length-normalized keyword-overlap bonus (up to +0.15)
 * - Filters by minScore (default 0.55) and returns Top-K = 3 chunks with normalized % match scores.
 *
 * @param {string} question - The user's query.
 * @param {number} [topK=3] - Maximum number of top matching chunks to return.
 * @param {number} [minScore=0.55] - Minimum hybrid similarity threshold.
 * @returns {Promise<Array<Object>>} Top matching chunk records with score & matchPercent.
 */
export async function searchPolicyChunks(question, topK = 3, minScore = 0.55) {
  if (!question || typeof question !== "string" || !question.trim()) {
    return [];
  }

  const records = loadVectorStore(false);
  if (records.length === 0) {
    return [];
  }

  const expandedQuery = expandShortQuery(question);
  const queryEmbedding = await getEmbedding(expandedQuery, "RETRIEVAL_QUERY");

  const scoredChunks = records
    .map((record) => {
      const cosineScore = cosineSimilarity(queryEmbedding, record.embedding);
      const keywordBonus = computeKeywordOverlapBonus(question, record.text);
      const hybridScore = Math.min(0.99, Math.max(0, cosineScore + keywordBonus));
      const normalizedScore = Number(hybridScore.toFixed(4));
      const matchPercent = Number((normalizedScore * 100).toFixed(1));

      return {
        id: record.id,
        chunkIndex: record.chunkIndex,
        section: record.section || "Policy Section",
        text: record.text,
        cosineScore: Number(cosineScore.toFixed(4)),
        keywordBonus,
        score: normalizedScore,
        matchPercent,
      };
    })
    .filter((item) => item.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scoredChunks;
}
