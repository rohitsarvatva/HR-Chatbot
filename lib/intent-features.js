import natural from "natural";

const { PorterStemmer } = natural;

/**
 * Normalizes raw user text for intent classification while preserving
 * alphanumeric words and collapsing punctuation/extra whitespace.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeIntentText(text) {
  if (typeof text !== "string") return "";
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extracts stemmed unigram + bigram features using natural.PorterStemmer.
 * Keeps stopwords so short conversational utterances ("hi", "who are you",
 * "how are you", "what can you do") and personal pronouns ("my attendance")
 * retain discriminative unigram and bigram signals.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function extractIntentFeatures(text) {
  const normalized = normalizeIntentText(text);
  if (!normalized) return [];

  const unigrams = PorterStemmer.tokenizeAndStem(normalized, true).filter(
    Boolean,
  );
  if (unigrams.length === 0) return [];

  const features = [...unigrams];
  for (let i = 0; i < unigrams.length - 1; i += 1) {
    features.push(`${unigrams[i]}_${unigrams[i + 1]}`);
  }

  return features;
}
