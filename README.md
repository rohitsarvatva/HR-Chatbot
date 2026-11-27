# HR Policy RAG Chatbot

## Project Overview

The HR Policy RAG Chatbot is a web application that answers employee questions using the organization's Archemist Studio OS v1 HR and Operations Policy manual. It uses retrieval-augmented generation (RAG) so that responses are grounded in policy excerpts instead of relying only on a general-purpose model.

The chatbot is intended to make HR information easier to find for topics such as shift timings, late-arrival rules, leave approval, attendance, onboarding, offboarding, and departmental procedures.

## Goals

- Provide concise, policy-grounded answers to HR questions.
- Prevent the AI from inventing rules that are absent from the policy manual.
- Retrieve the most relevant policy sections before generating an answer.
- Display the retrieved source chunks and their match scores for transparency.
- Stream answers in real time while keeping the interface responsive.
- Cache the pre-built vector index and repeated query embeddings in memory.
- Keep short-term conversational context and resolve follow-up pronouns.
- Save selective durable user facts locally across new chats.

## Features

- Embeddable floating website chatbot popover anchored to the bottom-right corner with a circular avatar launcher.
- Two-tab popover navigation (`Chat` and `History`, without any `Voice` tab).
- Clean customer-facing answers without displaying internal chunk IDs, match scores, or section citations in the UI.
- Preset quick questions for common HR topics.
- Server-side hybrid retrieval combining semantic similarity and keyword overlap.
- Top-3 retrieval with a 55% minimum similarity threshold.
- Section-aware PDF chunking.
- NDJSON streaming for retrieved sources and generated answer tokens.
- Pause/cancel support for active searches.
- Graceful behavior when no matching chunk or API key is available.
- Automatic loading of the pre-built vector store on server startup.
- Intent routing for policy questions and conversational chitchat.
- Standalone follow-up query rewriting with the configured `GEMINI_ROUTING_MODEL` or `GEMINI_CHAT_MODEL`.
- Browser-persistent selective user memory (`archemist_hr_user_memory`).
- Individual chat deletion (trash icon on every History card), `Clear All`, and `+ New Chat` controls in the `History` tab.

## Technology Stack

### Application

- Next.js 16.4.6
- React 19.3.1
- React DOM 19.3.1
- JavaScript and JSX
- CSS with Tailwind CSS 4.3.5

### AI and Retrieval

- Google Gemini API through `@google/genai`
- `gemini-embedding-001` for 768-dimension document and query embeddings
- `GEMINI_CHAT_MODEL` for streamed answer generation
- `GEMINI_ROUTING_MODEL` for intent routing, query rewriting, and memory extraction
- Optional Gemini chat model override for streamed responses
- Local cosine-similarity search
- Lightweight keyword-overlap ranking
- JSON-based vector store stored in `data/vector-store.json`

### Document Processing

- `pdf-parse` for PDF text extraction
- Custom section-aware and sentence-preserving chunking
- Custom PDF glyph normalization

## Project Structure

```text
HR Chatbot/
├── app/
│   ├── api/
│   │   ├── chat/route.js       # Hybrid retrieval and streaming answer endpoint
│   │   └── ingest/route.js     # Loads the pre-built vector store
│   ├── globals.css             # Global and Tailwind application styles
│   ├── layout.js               # Root layout
│   └── page.js                 # Chat UI and RAG Inspector
├── data/
│   ├── archemist-studio-os-policy.pdf
│   └── vector-store.json       # Pre-built chunks and embeddings
├── lib/
│   └── rag-engine.js           # Chunking, embeddings, vector loading, and hybrid search
├── private-docs/
│   └── archemist-studio-os-policy.pdf
├── scripts/
│   └── build-index.js          # Builds the vector store from the policy PDF
├── .env.local                  # Local secrets and optional model configuration
├── jsconfig.json               # Path aliases
├── next.config.mjs
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
10. A length-normalized keyword-overlap bonus of up to 15% is added to the semantic score (mildly dampened for chunks exceeding 400 characters).
11. The system returns up to three chunks scoring at least 55%.
12. If no chunk qualifies, the application states that the policy does not specify the answer.
13. If chunks qualify, they are sent to the client and included in the Gemini prompt.
14. Gemini streams a concise answer strictly grounded in those excerpts.

## Conversational Memory Workflow

1. The chat UI sends recent `messages`, a `longTermMemory` array, and the latest question with every request.
2. Simple greetings and pleasantries bypass Gemini retrieval and are answered directly in chitchat mode.
3. A temperature-zero routing JSON call classifies intent as `CHITCHAT` or `POLICY`.
4. The pre-processing call rewrites pronoun-based follow-ups into standalone vector-search queries using recent context.
5. Durable role, department, location, shift-preference, or workflow details may become a concise `newMemoryFact`.
6. Greetings and one-off policy questions are excluded from long-term memory extraction.
7. Saved facts are deduplicated in `localStorage` under `archemist_hr_user_memory`.
8. Final answer generation receives `<USER_MEMORY>`, `<CHAT_HISTORY>`, and `<POLICY_CONTEXT>` blocks.
9. New Chat clears short-term messages only; saved local memory remains available.

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

- `sources` — retrieved chunks and match scores
- `sources` — intent, rewritten query, retrieved chunks, and optional new memory fact
- `text` — streamed answer tokens
- `error` — a processing or configuration error

## Search and Response Rules

- Retrieval uses `Top-K = 3`.
- Retrieval requires a minimum hybrid score of `0.55`.
- Short queries containing fewer than four words receive HR-policy context expansion.
- Repeated query embeddings are cached in memory.
- The model is instructed to answer strictly what was asked from supplied excerpts (`temperature: 0.1`) using Adaptive Scope & Zero-Filler Rules (1–2 crisp sentences for narrow facts, concise bullets for broad policies/processes, strict scope boundaries without volunteering adjacent rules or penalties unless asked, zero filler, and contrastive few-shot examples).
- Simple chitchat and greeting variants (`hi`, `hie`, `hii`, `hello`, `helo`, `hey`, `hiya`, etc.) skip vector retrieval and return a consistent short greeting reply (`"Hello again! How can I help?"`), while policy questions prefixed with a greeting still route to policy retrieval.
- Follow-up questions are rewritten using recent policy context only when a deterministic context-rewrite guard detects pronouns, follow-up phrases, or very short queries.
- Prior greetings and responses with zero cited policy chunks are excluded from context-rewrite history.
- Durable facts are stored only in browser `localStorage` and remain separate from short-term chat messages.
- New Chat clears the conversation but preserves local memory.
- Opening the chatbot via the floating launcher (or reloading the page) always starts a fresh new chat on the `Chat` tab while preserving previous non-empty conversations in `History` (`archemist_hr_chat_sessions_v1`) and keeping saved memory (`archemist_hr_user_memory`).
- Historical conversation threads can be revisited, managed, and deleted from the `History` tab or header menu.
- If a specific policy detail is not covered in the manual, the assistant responds naturally with helpful topic suggestions rather than outputting robotic error strings.

## Project Phases & Checkpoints

- **Phase 1 / V1 (Checkpoint — `v1.0-checkpoint`)**: Core Hybrid RAG Engine (`lib/rag-engine.js`), section-aware PDF indexing (`scripts/build-index.js`), NDJSON streaming (`/api/chat`), short-term context rewriting, selective long-term user memory (`archemist_hr_user_memory`), and full-screen inspection dashboard.
- **Phase 2 / V2 (Current)**: Website-integrated floating chatbot popover UI (`Rohit AI • Personal Assistant`) anchored to the bottom-right corner with circular avatar launcher, streamlined header (close button only), 2-tab navigation (`Chat` & `History`, no `Voice`), per-chat deletion controls, hidden internal chunk metadata, and natural small-talk & fallback responses.

## Deployment Notes

- Configure `GEMINI_API_KEY` as a server-side environment variable on the hosting platform.
- Ensure `data/vector-store.json` is included in the deployment.
- Serverless instances may have separate memory caches, so cold starts must read the local vector store from disk.
- Keep PDF and vector-store updates together when the policy changes.

## Maintenance

1. Replace or update the source policy PDF.
2. Run `npm run build:index`.
3. Verify the chunk count and sample retrievals.
4. Run `npm run build`.
5. Update [Brag.md](./Brag.md) with the change.
