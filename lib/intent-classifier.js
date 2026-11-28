import fs from "fs";
import path from "path";
import natural from "natural";
import { extractIntentFeatures } from "./intent-features.js";

const { BayesClassifier } = natural;

const MODEL_PATH = path.join(process.cwd(), "data", "intent-model.json");
const CHITCHAT_MARGIN_THRESHOLD = 2.0;
const OUT_OF_SCOPE_MARGIN_THRESHOLD = 1.5;
const AMBIGUOUS_MARGIN_THRESHOLD = 1.05;

/**
 * Fallback balanced training corpus used only if data/intent-model.json
 * has not been generated yet.
 */
const FALLBACK_TRAINING_DATA = {
  CHITCHAT: [
    "hi",
    "hie",
    "hello",
    "hey",
    "hey there",
    "good morning",
    "good afternoon",
    "good evening",
    "thanks",
    "thank you so much",
    "bye",
    "goodbye",
    "see you later",
    "who are you",
    "what can you do",
    "help me",
    "how are you",
    "nice to meet you",
  ],
  DB_LOOKUP: [
    "how many leaves do i have left",
    "check my leave balance",
    "show my attendance",
    "my duty calendar",
    "remaining paid leaves",
    "late marks this month",
    "my attendance record",
    "how many sick leaves are left for me",
    "check my pending requests",
    "my attendance summary",
    "show my absence history",
    "how many casual leaves remaining",
    "am i marked late today",
    "my monthly attendance report",
    "check my remaining earned days",
    "my login time today",
    "my approved time off this year",
    "when was my last check in",
  ],
  POLICY_RAG: [
    "what is the sick leave policy",
    "how many casual leaves are allowed",
    "office timings and grace period",
    "work from home rules",
    "notice period for resignation",
    "probation period duration",
    "overtime compensation policy",
    "reimbursement process",
    "how does the leave approval workflow work",
    "what is the late arrival threshold rule",
    "what happens when i close my browser tab",
    "how do i onboard an employee",
    "offboarding and exit procedure",
    "maternity and paternity leave policy",
    "official shift timings and break schedule",
    "holiday list and comp off rules",
    "earned leave carryover and encashment rules",
    "how many sick leaves do i get per year",
  ],
  OUT_OF_SCOPE: [
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
    "explain quantum computing in simple terms",
    "convert 100 usd to indian rupees",
    "order pizza online for dinner",
  ],
};

let cachedClassifier = null;
let loadedFromDisk = false;

/**
 * Trains a fallback in-memory Naive Bayes classifier if data/intent-model.json
 * is absent or unreadable.
 */
function buildFallbackClassifier() {
  const classifier = new BayesClassifier();
  for (const [label, utterances] of Object.entries(FALLBACK_TRAINING_DATA)) {
    for (const utterance of utterances) {
      const features = extractIntentFeatures(utterance);
      if (features.length > 0) {
        classifier.addDocument(features, label);
      }
    }
  }
  classifier.train();
  return classifier;
}

/**
 * Loads the pre-trained serialized model from data/intent-model.json once at
 * server startup using natural.BayesClassifier.restore(...), falling back safely
 * to in-memory training if the file does not exist yet.
 */
function getClassifier() {
  if (cachedClassifier) {
    return cachedClassifier;
  }

  if (fs.existsSync(MODEL_PATH)) {
    try {
      const raw = fs.readFileSync(MODEL_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      cachedClassifier = BayesClassifier.restore(parsed);
      loadedFromDisk = true;
      return cachedClassifier;
    } catch (error) {
      console.error(
        "[IntentClassifier] Failed to restore data/intent-model.json; using in-memory fallback:",
        error,
      );
    }
  }

  cachedClassifier = buildFallbackClassifier();
  loadedFromDisk = false;
  return cachedClassifier;
}

// Load or train once on module initialization so request latency stays sub-millisecond.
getClassifier();

export function isIntentModelLoadedFromDisk() {
  return loadedFromDisk;
}

/**
 * Classifies a user message into CHITCHAT, DB_LOOKUP, POLICY_RAG, or OUT_OF_SCOPE
 * using the restored Naive Bayes model (unigram + bigram stemmed features) with
 * confidence & margin guardrails.
 *
 * - Only returns CHITCHAT when CHITCHAT is the top class AND beats the
 *   runner-up by at least 2.0x, ensuring mixed queries like
 *   "hi, what does the studio policy say about leaves?" route safely to POLICY_RAG.
 * - Defaults safely to POLICY_RAG on empty, unseen, or ambiguous inputs.
 *
 * @param {string} message
 * @returns {{ intent: "CHITCHAT" | "DB_LOOKUP" | "POLICY_RAG" | "OUT_OF_SCOPE", confidence: number }}
 */
export function classifyIntent(message) {
  const features = extractIntentFeatures(message);
  if (features.length === 0) {
    return { intent: "POLICY_RAG", confidence: 0 };
  }

  const classifier = getClassifier();
  const classifications = classifier.getClassifications(features);

  if (!Array.isArray(classifications) || classifications.length === 0) {
    return { intent: "POLICY_RAG", confidence: 0 };
  }

  const top = classifications[0];
  const second = classifications[1];
  const topValue = typeof top?.value === "number" ? top.value : 0;
  const secondValue = typeof second?.value === "number" ? second.value : 0;
  const totalValue = classifications.reduce(
    (sum, item) => sum + (typeof item?.value === "number" ? item.value : 0),
    0,
  );
  const confidence = totalValue > 0 ? topValue / totalValue : 0;
  const margin = topValue / (secondValue || 1e-9);

  if (top.label === "CHITCHAT") {
    if (topValue > 0 && margin >= CHITCHAT_MARGIN_THRESHOLD) {
      return { intent: "CHITCHAT", confidence };
    }
    return { intent: "POLICY_RAG", confidence };
  }

  if (top.label === "OUT_OF_SCOPE") {
    if (topValue > 0 && margin >= OUT_OF_SCOPE_MARGIN_THRESHOLD) {
      return { intent: "OUT_OF_SCOPE", confidence };
    }
    return { intent: "POLICY_RAG", confidence };
  }

  if (margin < AMBIGUOUS_MARGIN_THRESHOLD) {
    return { intent: "POLICY_RAG", confidence };
  }

  return {
    intent: top.label || "POLICY_RAG",
    confidence,
  };
}
