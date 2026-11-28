import fs from "fs";
import path from "path";
import natural from "natural";
import { extractIntentFeatures } from "../lib/intent-features.js";

const DATASET_PATH = path.join(process.cwd(), "data", "intent-dataset.json");
const MODEL_OUTPUT_PATH = path.join(process.cwd(), "data", "intent-model.json");

function pad(value, width) {
  const str = String(value);
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}

function getTopFeaturesForClass(classifier, vocabKeys, label, limit = 8) {
  const featureCounts = classifier?.classifier?.classFeatures?.[label] || {};
  return Object.entries(featureCounts)
    .map(([idx, count]) => [vocabKeys[Number(idx)] || `#${idx}`, count])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([feature, count]) => `${feature}(${count})`);
}

function main() {
  if (!fs.existsSync(DATASET_PATH)) {
    throw new Error(
      `Intent dataset not found at ${DATASET_PATH}. Run "npm run intent:generate" first.`,
    );
  }

  const dataset = JSON.parse(fs.readFileSync(DATASET_PATH, "utf-8"));
  const intents = dataset?.intents;
  if (!intents || typeof intents !== "object") {
    throw new Error(
      "Invalid data/intent-dataset.json format: missing top-level 'intents' object.",
    );
  }

  const classifier = new natural.BayesClassifier();
  const classSummary = [];

  for (const [label, utterances] of Object.entries(intents)) {
    if (!Array.isArray(utterances)) continue;
    let added = 0;
    let totalFeatureTokens = 0;

    for (const utterance of utterances) {
      const features = extractIntentFeatures(utterance);
      if (features.length === 0) continue;
      classifier.addDocument(features, label);
      added += 1;
      totalFeatureTokens += features.length;
    }

    classSummary.push({
      label,
      samples: added,
      avgFeatures: added > 0 ? (totalFeatureTokens / added).toFixed(1) : "0.0",
    });
  }

  classifier.train();

  const serializedModel = JSON.stringify(classifier, null, 2);
  fs.mkdirSync(path.dirname(MODEL_OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(MODEL_OUTPUT_PATH, serializedModel, "utf-8");

  const vocabKeys = Object.keys(classifier?.features || {});
  const totalVocab = vocabKeys.length;
  const totalSamples = classSummary.reduce((sum, row) => sum + row.samples, 0);

  console.log(`\nTrained Naive Bayes Intent Classifier -> ${MODEL_OUTPUT_PATH}`);
  console.log(
    `Total Samples: ${totalSamples} | Total Learned Vocabulary Features (unigrams + bigrams): ${totalVocab}\n`,
  );

  const header = `${pad("INTENT CLASS", 16)} | ${pad("SAMPLES", 9)} | ${pad("AVG FEAT", 10)} | TOP LEARNED FEATURES`;
  console.log(header);
  console.log("-".repeat(header.length + 45));

  for (const row of classSummary) {
    const topFeatures = getTopFeaturesForClass(
      classifier,
      vocabKeys,
      row.label,
      8,
    ).join(", ");
    console.log(
      `${pad(row.label, 16)} | ${pad(row.samples, 9)} | ${pad(row.avgFeatures, 10)} | ${topFeatures}`,
    );
  }
  console.log("");
}

try {
  main();
} catch (err) {
  console.error("Failed to train intent classifier:", err);
  process.exit(1);
}
