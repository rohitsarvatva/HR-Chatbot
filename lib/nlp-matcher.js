import natural from "natural";

const { PorterStemmer, WordTokenizer, JaroWinklerDistance } = natural;

const wordTokenizer = new WordTokenizer();

export const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "does",
  "for", "from", "had", "has", "have", "how", "i", "if", "in", "into", "is",
  "it", "its", "many", "me", "my", "no", "not", "of", "on", "or", "our",
  "policy", "rules", "should", "so", "such", "that", "the", "their", "them",
  "then", "there", "these", "they", "this", "to", "up", "us", "was", "we",
  "were", "what", "when", "where", "which", "who", "why", "will", "with",
  "would", "you", "your", "archemist", "regarding",
]);

/**
 * Lowercases text, tokenizes into alphanumeric words (minimum length 2),
 * removes stopwords, stems each token using PorterStemmer, and returns
 * an array of unique root stems.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function extractStems(text) {
  if (!text || typeof text !== "string") {
    return [];
  }

  const normalized = text.toLowerCase().replace(/_/g, " ");
  const rawTokens = wordTokenizer.tokenize(normalized) || [];
  const stems = new Set();

  for (const token of rawTokens) {
    if (token.length < 2) continue;
    if (!/^[a-z0-9]+$/.test(token)) continue;
    if (STOPWORDS.has(token)) continue;

    const stem = PorterStemmer.stem(token);
    if (stem) {
      stems.add(stem);
    }
  }

  return Array.from(stems);
}

/**
 * Checks whether a query stem matches any chunk stem via:
 * - Exact stem equality (`cStem === qStem`), OR
 * - Jaro-Winkler fuzzy similarity >= 0.90 (only for stems with length >= 4).
 *
 * @param {string} qStem
 * @param {string[]} chunkStems
 * @returns {boolean}
 */
export function stemMatchesChunk(qStem, chunkStems) {
  if (!qStem || !Array.isArray(chunkStems) || chunkStems.length === 0) {
    return false;
  }

  if (chunkStems.includes(qStem)) {
    return true;
  }

  if (qStem.length < 4) {
    return false;
  }

  for (const cStem of chunkStems) {
    if (cStem.length >= 4 && JaroWinklerDistance(qStem, cStem) >= 0.9) {
      return true;
    }
  }

  return false;
}

/**
 * Computes the NLP keyword bonus (capped at +0.15) from pre-extracted
 * query stems and cached chunk stems.
 *
 * @param {string[]} queryStems
 * @param {string[]} chunkStems
 * @returns {number}
 */
export function computeStemmedKeywordBonus(queryStems, chunkStems) {
  if (!Array.isArray(queryStems) || queryStems.length === 0) {
    return 0;
  }
  if (!Array.isArray(chunkStems) || chunkStems.length === 0) {
    return 0;
  }

  let matchedCount = 0;
  for (const qStem of queryStems) {
    if (stemMatchesChunk(qStem, chunkStems)) {
      matchedCount += 1;
    }
  }

  const bonus = Math.min(1, matchedCount / queryStems.length) * 0.15;
  return Number(bonus.toFixed(4));
}
