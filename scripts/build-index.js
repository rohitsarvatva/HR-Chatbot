import fs from "fs";
import path from "path";
import * as pdfParseModule from "pdf-parse";
import {
  chunkText,
  getEmbedding,
  normalizePdfGlyphs,
  saveVectorStore,
} from "../lib/rag-engine.js";

/**
 * Automatically loads .env.local into process.env if GEMINI_API_KEY is not already set,
 * so `node scripts/build-index.js` can be run directly without extra CLI flags.
 */
function loadEnvLocal() {
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== "your_api_key_here") {
    return;
  }

  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const val = trimmed.slice(eqIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && !process.env[key]) {
      process.env[key] = val;
    }
  }
}

async function extractPdfContent(buffer) {
  if (typeof pdfParseModule.PDFParse === "function") {
    const parser = new pdfParseModule.PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return {
        text: normalizePdfGlyphs(result?.text || ""),
        totalPages: result?.total ?? result?.pages?.length ?? 0,
      };
    } finally {
      if (typeof parser.destroy === "function") {
        await parser.destroy();
      }
    }
  }

  const parseFn = pdfParseModule.default || pdfParseModule;
  const data = await parseFn(buffer);
  return {
    text: normalizePdfGlyphs(data?.text || ""),
    totalPages: data?.numpages ?? 0,
  };
}

function resolvePdfPath() {
  const dataPdfPath = path.join(
    process.cwd(),
    "data",
    "archemist-studio-os-policy.pdf"
  );
  if (fs.existsSync(dataPdfPath)) {
    return dataPdfPath;
  }

  const privatePdfPath = path.join(
    process.cwd(),
    "private-docs",
    "archemist-studio-os-policy.pdf"
  );
  if (fs.existsSync(privatePdfPath)) {
    return privatePdfPath;
  }

  throw new Error(
    "Could not find archemist-studio-os-policy.pdf in data/ or private-docs/."
  );
}

async function main() {
  loadEnvLocal();

  const pdfPath = resolvePdfPath();
  console.log(`Reading PDF from: ${pdfPath}`);

  const buffer = fs.readFileSync(pdfPath);
  const { text, totalPages } = await extractPdfContent(buffer);
  const chunks = chunkText(text, 750, 900);

  console.log(
    `Extracted ${totalPages} pages -> ${chunks.length} section-aware chunks. Generating embeddings...`
  );

  const records = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunkContent = chunks[i];
    const sectionMatch = chunkContent.match(/^\[Section:\s*(.*?)\]/);
    const section = sectionMatch ? sectionMatch[1] : "General Policy";
    const embedding = await getEmbedding(chunkContent, "RETRIEVAL_DOCUMENT");

    records.push({
      id: `chunk-${i + 1}`,
      chunkIndex: i,
      section,
      totalPages,
      text: chunkContent,
      embedding,
    });

    console.log(
      `  [${i + 1}/${chunks.length}] ${records[i].id} (${chunkContent.length} chars) — ${section}`
    );
  }

  saveVectorStore(records);
  console.log(
    `\nSuccessfully wrote ${records.length} records to data/vector-store.json`
  );
}

main().catch((err) => {
  console.error("Failed to build vector index:", err);
  process.exit(1);
});
