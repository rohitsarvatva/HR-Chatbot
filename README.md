# HR Policy RAG Chatbot

## Project Overview

The HR Policy RAG Chatbot is a web application that answers employee questions using the organization's Archemist Studio OS v1 HR and Operations Policy manual. It uses retrieval-augmented generation (RAG) so that responses are grounded in policy excerpts instead of relying only on a general-purpose model.

The chatbot is intended to make HR information easier to find for topics such as shift timings, late-arrival rules, leave approval, attendance, onboarding, offboarding, and departmental procedures.

## Goals

- Provide concise, policy-grounded answers to HR questions.
- Prevent the AI from inventing rules that are absent from the policy manual.
- Retrieve the most relevant policy sections before generating an answer.
- Stream retrieved source metadata in the API response while keeping the customer-facing UI clean of internal chunk IDs and raw scores.
- Stream answers in real time while keeping the interface responsive.
- Cache the pre-built vector index, precomputed chunk stems, intent model, and repeated query embeddings in memory.
- Keep short-term conversational context and resolve follow-up pronouns.
- Save selective durable user facts locally across new chats.

## Features

- Embeddable floating website chatbot popover anchored to the bottom-right corner with a circular avatar launcher.
- Two-tab popover navigation (`Chat` and `History`, without any `Voice` tab).
- Clean customer-facing answers without displaying internal chunk IDs, match scores, or section citations in the UI.
- Preset quick questions for common HR topics.
- Server-side hybrid retrieval combining semantic similarity with Porter-stemmed and Jaro-Winkler fuzzy keyword overlap.
- Top-3 retrieval with a 55% minimum similarity threshold.
- Section-aware PDF chunking.
- NDJSON streaming for retrieved sources and generated answer tokens.
- Pause/cancel support for active searches.
- Graceful behavior when no matching chunk or API key is available.
- Automatic loading of the pre-built vector store and serialized intent classifier on server startup.
- Sub-millisecond server-side Naive Bayes intent classification (`POLICY_RAG`, `CHITCHAT`, `DB_LOOKUP`, `OUT_OF_SCOPE`) with a `CHITCHAT` fast-path that bypasses embeddings and vector search.
- Standalone follow-up query rewriting with the configured `GEMINI_ROUTING_MODEL` or `GEMINI_CHAT_MODEL` (gated by a deterministic rewrite guard).
- Browser-persistent selective user memory (`archemist_hr_user_memory`).
- Individual chat deletion (trash icon on every History card), `Clear All`, and `+ New Chat` controls in the `History` tab.

## Technology Stack

### Application

- Next.js 16.4.6 (App Router; `serverExternalPackages` configured for `pdf-parse` and `natural`)
- React 19.3.1 & React DOM 19.3.1
- JavaScript, JSX, and TypeScript (server routes)
- CSS with Tailwind CSS 4.3.5
- Optional Supabase persistence via `@supabase/supabase-js` (`^2.119.2`) alongside browser `localStorage` history and memory

### AI and Retrieval

- Google Gemini API through `@google/genai` (`^3.4.0`)
- `gemini-embedding-001` for 768-dimension document and query embeddings (with in-memory query embedding cache)
- `GEMINI_CHAT_MODEL` for streamed answer generation (`temperature: 0.1`, Adaptive Scope & Zero-Filler prompting)
- `GEMINI_ROUTING_MODEL` for intent routing, query rewriting, and durable memory extraction
- Optional Gemini chat model override for streamed responses
- Local cosine-similarity hybrid search (`topK = 3`, `minScore = 0.55`)
- JSON-based vector store stored in `data/vector-store.json` (loaded and cached in memory on startup)

### NLP, Intent Classification & Fuzzy Keyword Matching (Part 3)

- `natural` (`^8.2.6`, isolated server-side in `lib/nlp-matcher.js`, `lib/intent-features.js`, and `lib/intent-classifier.js` via `serverExternalPackages`)
- Auto-generated Naive Bayes training pipeline (`scripts/generate-intent-data.js` using `dotenv` and `gemini-3.1-flash-lite` structured JSON output over all 18 chunks in `data/vector-store.json` + `scripts/train-intent.js`) producing a balanced 144-sample 4-class dataset (`data/intent-dataset.json`: 36 samples each across `POLICY_RAG`, `CHITCHAT`, `DB_LOOKUP`, `OUT_OF_SCOPE`) and a serialized unigram + bigram Porter-stemmed `natural.BayesClassifier` model (`data/intent-model.json`)
- Shared `lib/intent-features.js` (`normalizeIntentText`, `extractIntentFeatures`) preserving stopwords so short greetings (`"hi"`, `"who are you"`, `"how are you"`) and personal pronouns (`"my attendance"`, `"my leave balance"`) retain discriminative unigram and bigram signals identically at training time and runtime
- Runtime `lib/intent-classifier.js` restores `data/intent-model.json` once at server startup via `natural.BayesClassifier.restore(...)` (with in-memory fallback) and enforces runner-up margin guardrails (`>= 2.0x` for `CHITCHAT`, `>= 1.5x` for `OUT_OF_SCOPE`, `< 1.05` ambiguous default to `POLICY_RAG`) so mixed queries (e.g., `"hi, what does the studio policy say about leaves?"`) route safely to `POLICY_RAG` while pure greetings/thanks bypass `gemini-embedding-001` and vector search on a fast-path
- `natural.WordTokenizer` for alphanumeric tokenization (minimum length 2) with stopword filtering
- `natural.PorterStemmer` for root-stem extraction (`extractStems`) and in-memory precomputed `chunkStems` caching on vector-store load
- `natural.JaroWinklerDistance` (`>= 0.90` similarity threshold for stems of length `>= 4`) for typo-tolerant hybrid keyword bonus scoring (up to `+0.15`)

### Document Processing

- `pdf-parse` (`^2.4.5`) for PDF text extraction
- Custom section-aware and sentence-preserving chunking
- Custom PDF glyph normalization

## Project Structure

```text
HR Chatbot/
├── app/
│   ├── api/
│   │   ├── chat/route.js                       # Intent fast-path, hybrid retrieval, and NDJSON streaming endpoint
│   │   ├── history/                            # Optional Supabase chat session & message history endpoints
│   │   │   ├── route.ts
│   │   │   └── session/
│   │   │       ├── route.ts
│   │   │       └── [id]/route.ts
│   │   └── ingest/route.js                     # Loads the pre-built vector store
│   ├── globals.css                             # Global and Tailwind application styles
│   ├── layout.js                               # Root layout
│   └── page.js                                 # Embeddable floating chatbot popover UI (Chat & History tabs)
├── data/
│   ├── archemist-studio-os-policy.pdf
│   ├── intent-dataset.json                     # Balanced 4-class intent training dataset generated from policy chunks
│   ├── intent-model.json                       # Serialized natural.BayesClassifier unigram + bigram intent model
│   └── vector-store.json                       # Pre-built chunks and embeddings
├── lib/
│   ├── intent-classifier.js                    # Server-side Naive Bayes intent router (restores data/intent-model.json)
│   ├── intent-features.js                      # Shared Porter-stemmed unigram + bigram feature extractor
│   ├── nlp-matcher.js                          # Server-side Porter Stemmer & Jaro-Winkler fuzzy keyword matching
│   ├── rag-engine.js                           # Chunking, embeddings, vector loading, and hybrid search
│   └── supabaseServer.ts                       # Optional Supabase server client and employee lookup helpers
├── private-docs/
│   └── archemist-studio-os-policy.pdf
├── scripts/
│   ├── build-index.js                          # Builds the vector store from the policy PDF
│   ├── generate-intent-data.js                 # Auto-generates balanced intent training data from vector-store.json
│   └── train-intent.js                         # Trains and serializes natural.BayesClassifier to data/intent-model.json
├── .env.local                                  # Local secrets and optional model configuration
├── jsconfig.json                               # Path aliases
├── next.config.mjs                             # serverExternalPackages & data/ file tracing config
├── package.json
└── package-lock.json
```

## RAG Workflow

1. A PDF containing the HR policy is supplied in `data/` or `private-docs/`.
2. `scripts/build-index.js` extracts the PDF text.
3. Custom logic normalizes PDF glyphs and identifies policy sections.
4. The text is split into section-aware chunks of approximately 600-900 characters.
5. Each chunk is embedded using Gemini's `gemini-embedding-001` model.
6. Chunk metadata and 768-dimension vectors are saved to `data/vector-store.json`.
7. The server loads and caches the vector store in memory.
8. A user's question is expanded if it contains fewer than four words.
9. The question is embedded and compared with stored chunks using cosine similarity.
10. A Porter-stemmed and Jaro-Winkler fuzzy (`>= 0.90` for stems `>= 4` chars) keyword bonus of up to 15% is added to the semantic score using in-memory precomputed `chunkStems`.
11. The system returns up to three chunks scoring at least 55%.
12. If no chunk qualifies, the application states that the policy does not specify the answer.
13. If chunks qualify, they are sent to the client and included in the Gemini prompt.
14. Gemini streams a concise answer strictly grounded in those excerpts.

## Conversational Memory Workflow

1. The chat UI sends recent `messages`, a `longTermMemory` array, and the latest question with every request.
2. `lib/intent-classifier.js` runs a sub-millisecond Naive Bayes check (`POLICY_RAG`, `CHITCHAT`, `DB_LOOKUP`, `OUT_OF_SCOPE`) on every incoming message (`[IntentRouter]`). Confirmed `CHITCHAT` (`>= 2.0x` runner-up margin) takes a fast-path that bypasses `gemini-embedding-001`, vector search, and Gemini generation while still logging turns when Supabase is configured.
3. For non-chitchat turns that trigger the deterministic `needsContextRewrite` guard (pronouns, follow-up phrases, or very short queries with prior cited policy turns), a temperature-zero Gemini routing JSON call (`GEMINI_ROUTING_MODEL`) refines intent (`CHITCHAT` or `POLICY`), rewrites follow-ups into standalone vector-search queries, and extracts any durable `newMemoryFact`.
4. Durable role, department, location, shift-preference, or workflow details may become a concise `newMemoryFact`.
5. Greetings and one-off policy questions are excluded from long-term memory extraction.
6. Saved facts are deduplicated in `localStorage` under `archemist_hr_user_memory`.
7. Final answer generation receives `<USER_MEMORY>`, `<CHAT_HISTORY>`, and `<POLICY_CONTEXT>` blocks.
8. New Chat clears short-term messages only; saved local memory remains available.

## Requirements

- Windows, macOS, or Linux
- Node.js 20 or newer
- npm
- A Google Gemini API key with access to embeddings and chat models
- A policy PDF compatible with `pdf-parse`

## Environment Configuration

Create or update `.env.local` in the project root:

```dotenv
GEMINI_API_KEY=your_api_key_here
# Optional:
GEMINI_CHAT_MODEL=gemini-3.1-flash-lite
# Optional separate fast model for intent routing and memory extraction:
GEMINI_ROUTING_MODEL=gemini-3.1-flash-lite
```

Do not commit `.env.local` or any real API keys. Never expose an API key in client-side code or documentation.

## Installation

From the project root:

```powershell
npm install
```

## Build the Policy Vector Index

Place the policy PDF at one of these paths:

- `data/archemist-studio-os-policy.pdf`
- `private-docs/archemist-studio-os-policy.pdf`

Then run:

```powershell
npm run build:index
```

This extracts text, creates section-aware chunks, generates Gemini embeddings, and writes `data/vector-store.json`.

The index should be rebuilt whenever the source policy PDF changes.

## Generate & Train the Intent Classifier (Part 3)

After building or updating `data/vector-store.json`, regenerate the balanced 4-class intent training dataset and re-serialize the Naive Bayes model:

```powershell
npm run intent:generate
npm run intent:train
```

- `npm run intent:generate` reads all chunks in `data/vector-store.json`, generates 3 employee questions per chunk using `gemini-3.1-flash-lite`, balances 36 samples across `POLICY_RAG`, `CHITCHAT`, `DB_LOOKUP`, and `OUT_OF_SCOPE`, and writes `data/intent-dataset.json`.
- `npm run intent:train` extracts shared unigram + bigram Porter-stemmed features via `lib/intent-features.js`, trains `natural.BayesClassifier`, writes `data/intent-model.json`, and prints a per-class vocabulary summary table.

## Run Locally

```powershell
npm run dev
```

Open `http://localhost:3000`.

## Available Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js development server |
| `npm run build` | Create a production build |
| `npm run start` | Serve the production build |
| `npm run lint` | Run the configured Next.js lint command |
| `npm run build:index` | Extract PDF text and rebuild embeddings |
| `npm run intent:generate` | Auto-generate balanced intent training dataset (`data/intent-dataset.json`) from `vector-store.json` |
| `npm run intent:train` | Train and save serialized unigram+bigram Naive Bayes model (`data/intent-model.json`) |

## API Endpoints

### `GET /api/ingest`

Loads the pre-built vector store and returns its status and chunk count.

### `POST /api/ingest`

Reloads the existing pre-built vector store for ingestion-compatible clients.

### `POST /api/chat`

Accepts:

```json
{
  "question": "What is the late-arrival threshold?",
  "messages": [
    { "role": "user", "content": "I work as a site engineer." },
    { "role": "assistant", "content": "Understood." }
  ],
  "longTermMemory": ["User works as a site engineer."]
}
```

Returns NDJSON events:

- `sources` — `intent`, `classifiedIntent` (`CHITCHAT` | `POLICY_RAG` | `DB_LOOKUP` | `OUT_OF_SCOPE`), `rewrittenQuery`, retrieved `chunks` with match scores, `modelUsed`, and optional `newMemoryFact`
- `text` — streamed answer tokens
- `error` — a processing or configuration error

## Search and Response Rules

- Retrieval uses `Top-K = 3`.
- Retrieval requires a minimum hybrid score of `0.55`.
- Short queries containing fewer than four words receive HR-policy context expansion.
- Repeated query embeddings are cached in memory.
- The model is instructed to answer strictly what was asked from supplied excerpts (`temperature: 0.1`) using Adaptive Scope & Zero-Filler Rules (1–2 crisp sentences for narrow facts, concise bullets for broad policies/processes, strict scope boundaries without volunteering adjacent rules or penalties unless asked, zero filler, and contrastive few-shot examples).
- Simple chitchat and greeting variants (`hi`, `hie`, `hii`, `hello`, `helo`, `hey`, `hiya`, etc.) are routed by the Naive Bayes `CHITCHAT` fast-path (`>= 2.0x` margin) to deterministic short replies (such as `"Hello again! How can I help?"` or `DEFAULT_CHITCHAT_REPLY`) without running embeddings or vector search, while policy questions prefixed with a greeting still route to `POLICY_RAG`.
- Follow-up questions are rewritten using recent policy context only when a deterministic context-rewrite guard detects pronouns, follow-up phrases, or very short queries.
- Prior greetings and responses with zero cited policy chunks are excluded from context-rewrite history.
- Durable facts are stored only in browser `localStorage` and remain separate from short-term chat messages.
- New Chat clears the conversation but preserves local memory.
- Opening the chatbot via the floating launcher (or reloading the page) always starts a fresh new chat on the `Chat` tab while preserving previous non-empty conversations in `History` (`archemist_hr_chat_sessions_v1`) and keeping saved memory (`archemist_hr_user_memory`).
- Historical conversation threads can be revisited, managed, and deleted from the `History` tab.
- If a specific policy detail is not covered in the manual, the assistant responds naturally with helpful topic suggestions rather than outputting robotic error strings.

## Project Phases & Checkpoints

- **Phase 1 / V1 (Checkpoint 1 — `v1.0-checkpoint`)**: Core Hybrid RAG Engine (`lib/rag-engine.js`), section-aware PDF indexing (`scripts/build-index.js`), NDJSON streaming (`/api/chat`), short-term context rewriting, selective long-term user memory (`archemist_hr_user_memory`), and full-screen inspection dashboard.
- **Phase 2 / V2 (Checkpoint 2 — `v2.0-checkpoint`)**: Website-integrated floating chatbot popover UI (`Rohit AI • Personal Assistant`) anchored to the bottom-right corner with circular avatar launcher, streamlined header (close button only), 2-tab navigation (`Chat` & `History`, no `Voice`), per-chat deletion controls, fresh chat on launcher open/page reload while preserving non-empty history and user memory, hidden internal chunk metadata, expanded deterministic greeting/small-talk & natural fallback responses, tightened RAG retrieval (`topK = 3`, `minScore = 0.55`, chunk-length normalization), and Adaptive Scope & Zero-Filler prompting (`temperature: 0.1`).
- **Phase 3 / Part 3 (Current)**: Upgraded hybrid keyword matching in `lib/nlp-matcher.js` and `lib/rag-engine.js` with `natural` (`PorterStemmer`, `WordTokenizer`, `JaroWinklerDistance >= 0.90` for stems `>= 4` chars) and in-memory precomputed `chunkStems` on vector-store load; added a PDF-driven 4-class Naive Bayes intent pipeline (`lib/intent-features.js`, `scripts/generate-intent-data.js`, `scripts/train-intent.js`, `data/intent-dataset.json`, `data/intent-model.json`) and server-side router (`lib/intent-classifier.js`) supporting `POLICY_RAG`, `CHITCHAT`, `DB_LOOKUP`, and `OUT_OF_SCOPE` with runner-up margin guardrails (`>= 2.0x` on `CHITCHAT`, `>= 1.5x` on `OUT_OF_SCOPE`) integrated into `/api/chat` so casual chitchat takes a fast-path bypassing embeddings and vector search while preserving Supabase logging and RAG retrieval.

## Deployment Notes

- Configure `GEMINI_API_KEY` as a server-side environment variable on the hosting platform.
- Ensure `data/vector-store.json` and `data/intent-model.json` are included in the deployment (`next.config.mjs` includes `outputFileTracingIncludes` for `./data/**/*`).
- Serverless instances may have separate memory caches, so cold starts must read the local vector store and serialized intent model from disk.
- Keep PDF, vector-store, and intent-model updates together when the policy changes.

## Maintenance

1. Replace or update the source policy PDF.
2. Run `npm run build:index`.
3. Run `npm run intent:generate` and `npm run intent:train` to refresh `data/intent-dataset.json` and `data/intent-model.json`.
4. Verify the chunk count, intent distribution, and sample retrievals.
5. Run `npm run build`.
6. Update [Brag.md](./Brag.md) with the change.
