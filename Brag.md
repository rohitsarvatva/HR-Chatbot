# Project Change Log

This file tracks completed work, current work, and future plans for the HR Policy RAG Chatbot. Update it every time code or documentation is changed.

## Log Format

```markdown
### YYYY-MM-DD

#### Completed
- Summarize completed changes.

#### In Progress
- Summarize active work.

#### Issues or Decisions
- Record blockers, trade-offs, and technical decisions.

#### Next Steps
- List planned work for the next session.
```

## Past

### Initial Project Implementation

#### Completed
- Created a Next.js and React HR policy chatbot.
- Added a full-height responsive chat interface and RAG Inspector.
- Integrated Google Gemini embeddings and streamed chat responses.
- Added PDF text extraction and section-aware chunk generation.
- Added cosine-similarity retrieval with keyword-overlap ranking.
- Added an on-disk vector store and in-memory caching.
- Added Top-5 retrieval with a 35% minimum match threshold.
- Added quick questions, loading feedback, answer streaming, and search cancellation.
- Added `/api/chat` and `/api/ingest` routes.
- Added `scripts/build-index.js` to rebuild the vector index.
- Added sample HR policy PDF data and a pre-built `data/vector-store.json`.

#### Technical Decisions
- The project uses a local JSON vector store instead of a separate vector database.
- Retrieved chunks are sent directly to the chat client for transparency.
- The chat prompt is restricted to retrieved policy excerpts.
- Missing policy information produces an explicit fallback rather than an inferred answer.
- Query embeddings are cached by normalized question text during each server process lifetime.

## Present — Phase 3 / Part 3 (Post-Checkpoint 2)

> **Milestone Note**:
> - **Checkpoint 1 (Phase 1 / V1)** (`git tag: v1.0-checkpoint`): Everything completed prior to 2026-11-25 (core Hybrid RAG engine, memory, and full-screen inspection dashboard).
> - **Checkpoint 2 (Phase 2 / V2)** (`git tag: v2.0-checkpoint`): Everything completed from 2026-11-25 through 2026-11-27 (`d0c3e34`) covering the embeddable website popover UI, fresh-chat-on-open behavior, expanded greeting/chitchat routing, Adaptive Scope & Zero-Filler prompting, and tightened RAG retrieval (`topK = 3`, `minScore = 0.55`).
> - **Part 3 (Phase 3 / V3)**: Everything implemented after Checkpoint 2 belongs to Part 3.

### 2026-11-28 (Part 3 — PDF-Driven Intent Training Pipeline & Serialized Naive Bayes Model)

#### Completed
- Added shared unigram + bigram Porter-stemmed feature extractor `lib/intent-features.js` (`normalizeIntentText`, `extractIntentFeatures`) used identically at training time and runtime.
- Created `scripts/generate-intent-data.js` (`npm run intent:generate`, using `dotenv` `^18.0.10` and `@google/genai` with `gemini-3.1-flash-lite` structured JSON output) to read all 18 chunks from `data/vector-store.json`, generate 3 realistic employee questions per chunk (short/casual, natural workplace, and specific rule/number — 52 unique raw policy questions), and save a balanced 144-sample 4-class dataset (36 samples each across `POLICY_RAG`, `CHITCHAT`, `DB_LOOKUP`, and `OUT_OF_SCOPE`) to `data/intent-dataset.json`.
- Created `scripts/train-intent.js` (`npm run intent:train`) to train `natural.BayesClassifier` on unigram + bigram stemmed features, serialize the model to `data/intent-model.json`, and print a summary table of per-class sample counts, average features, and top learned vocabulary features.
- Updated `lib/intent-classifier.js` to restore `data/intent-model.json` once at server startup via `natural.BayesClassifier.restore(...)` (exposing `isIntentModelLoadedFromDisk()`), with safe in-memory fallback and runner-up margin guardrails (`>= 2.0x` for `CHITCHAT`, `>= 1.5x` for `OUT_OF_SCOPE`, and `< 1.05` ambiguous default to `POLICY_RAG`).
- Integrated `classifyIntent(question)` into `app/api/chat/route.js` right after optional Supabase auth/session validation with `[IntentRouter]` server logging, an extracted `createChitchatStreamResponse` helper + `DEFAULT_CHITCHAT_REPLY` fallback, a `CHITCHAT` fast-path bypassing `gemini-embedding-001` and `searchPolicyChunks` while persisting user and assistant turns to Supabase `chatbot_messages`, `classifiedIntent` metadata in NDJSON `sources` events, and `buildPriorPolicyMessages` updated to use `classifyIntent` for chitchat filtering.
- Updated project documentation (`README.md`, `Brag.md`, `AGENTS.md`, and `Personal Documentation/`) to reflect the full Part 3 NLP and intent classification pipeline.

#### Issues or Decisions
- Kept stopwords intact inside `lib/intent-features.js` (unlike `lib/nlp-matcher.js`, which strips stopwords for chunk retrieval) so short conversational utterances (`"who are you"`, `"how are you"`) and personal-data pronouns (`"my attendance"`, `"my leave balance"`) retain discriminative unigram and bigram signals.
- Enforced a strict `>= 2.0x` runner-up margin on `CHITCHAT` so mixed messages like `"hi, what does the studio policy say about leaves?"` default safely to `POLICY_RAG` instead of short-circuiting.
- Kept `DB_LOOKUP` and `OUT_OF_SCOPE` passing through to the RAG pipeline for now (`OUT_OF_SCOPE` naturally hits the `0.55` similarity threshold fallback with zero LLM generation cost) until dedicated database lookup handlers and an optional `OUT_OF_SCOPE` fast-path are wired up.

#### In Progress
- Continuing Part 3 retrieval and NLP enhancements (including future `DB_LOOKUP` database hooks).

#### Next Steps
- Wire `DB_LOOKUP` intent handling to live employee attendance/leave queries when Supabase auth is active.
- Add optional `OUT_OF_SCOPE` fast-path reply handling once validated against edge-case policy queries.
- Add automated test cases verifying intent classification accuracy, margin guardrails, and Porter/Jaro-Winkler retrieval scoring.

### 2026-11-27 (Part 3 — Starting Point)

#### Completed
- Finalized and locked all Phase 2 changes as **Checkpoint 2** (`git tag: v2.0-checkpoint` on commit `d0c3e34`).
- Updated `README.md`, `Brag.md`, and `AGENTS.md` to mark Checkpoint 2 as complete and designate all subsequent work as **Part 3 / Phase 3**.
- Added server-side NLP matching helper `lib/nlp-matcher.js` using `natural` (`PorterStemmer`, `WordTokenizer`, and `JaroWinklerDistance`) with stopword filtering and `extractStems(text)`.
- Upgraded `lib/rag-engine.js` to precompute and cache `chunkStems` in memory on first vector-store load (`loadVectorStore` / `saveVectorStore`) and compute `keywordBonus` in `searchPolicyChunks` via exact stem matches or Jaro-Winkler fuzzy similarity (`>= 0.90` for stems of length `>= 4`), preserving the `<= 0.15` bonus cap, hybrid score formula, embedding model, and existing retrieval thresholds.
- Added `"natural"` to `serverExternalPackages` in `next.config.mjs` to keep `natural` strictly server-side with no Next.js bundling conflicts.

#### In Progress
- Continuing Part 3 retrieval and NLP enhancements.

---

## Phase 2 / V2 Checkpoint Archive (Checkpoint 2 — 2026-11-25 to 2026-11-27)

### 2026-11-26 (Checkpoint 2 / Phase 2)

#### Completed
- Updated `app/page.js` so clicking the floating chatbot launcher (or opening/reloading the page) always starts a fresh new chat on the `Chat` tab instead of continuing the previous thread.
- Preserved previous conversations with user messages in the `History` tab (`archemist_hr_chat_sessions_v1`) and retained browser-persistent user memory (`archemist_hr_user_memory`), while preventing untouched empty sessions from accumulating in `History`.
- Expanded deterministic greeting detection in `app/api/chat/route.js` so casual greeting variants (`hi`, `hie`, `hii`, `hello`, `helo`, `hlo`, `hey`, `heyy`, `hiya`, `hy`, `namaste`, `good morning`, etc., with optional punctuation/emojis or addressees like `rohit`/`there`) all bypass policy retrieval and return the same concise reply (`"Hello again! How can I help?"`), while policy questions starting with a greeting still proceed to RAG retrieval.
- Updated `BASE_SYSTEM_INSTRUCTION` in `app/api/chat/route.js` with Adaptive Scope & Zero-Filler Rules plus two contrastive few-shot examples (narrow fact vs. broad policy) and set answer generation `temperature` to `0.1`.
- Tightened RAG retrieval in `lib/rag-engine.js` and `app/api/chat/route.js` to `topK = 3` and `minScore = 0.55`, and added mild chunk-length normalization (`sqrt(400 / len)` floored at `0.6` for chunks > 400 chars) to `computeKeywordOverlapBonus`.
- Updated the popover header in `app/page.js` to display `Personal Assistant` (replacing `Customer Service`) and removed the three-dots (`⋮`) options menu button from the header.

### 2026-11-25 (Checkpoint 2 / Phase 2)

#### Completed
- Marked the pre-popover full-screen RAG dashboard & memory implementation as **V1 (Checkpoint)** (`v1.0-checkpoint`) and started **Phase 2** for the website-integrated popover experience.
- Redesigned `app/page.js` into an embeddable website shell with an interactive floating chatbot popover anchored to the bottom-right corner and a circular avatar launcher button.
- Configured the popover bottom navigation bar with two tabs only (`Chat` and `History`), omitting the `Voice` tab.
- Removed the RAG Inspector and cited-chunk badges from the user-facing UI so users see clean policy answers without raw chunk metadata.
- Added always-visible per-chat delete (trash icon) buttons on every conversation card in the `History` tab, a `Clear All` action, and a `Delete Current Chat` option in the popover header menu.
- Expanded conversational chitchat detection (`"how r u?"`, `"how are you"`, `"who are you"`, `"what can you do"`, greetings, thanks, farewells) and replaced the robotic `"The current policy document does not specify this."` string with natural, helpful conversational responses.
- Updated pause behavior so pausing an active response replaces the assistant turn output with `"paused"` only.
- Made Supabase session persistence optional in `app/api/chat/route.js` when local Supabase environment variables are absent, preserving full local and browser-persistent chat functionality.

---

## Phase 1 / V1 Checkpoint Archive (Pre-2026-11-25)

### 2026-11-23 (V1 Checkpoint)

#### Completed
- Added short-term conversational memory using the most recent chat turns.
- Added Gemini intent routing and standalone query rewriting for follow-up policy questions.
- Added a deterministic rewrite guard to bypass unnecessary query-rewriting calls for self-contained policy questions.
- Added frontend cited-chunk metadata so chitchat and no-match turns are excluded from prior policy history.
- Added regex bypasses for greetings and simple pleasantries.
- Added selective long-term memory extraction through the pre-processing JSON call.
- Added browser-persistent memory under `archemist_hr_user_memory`.
- Added New Chat, Memory count, clear-all, and individual memory removal controls.
- Added rewritten-query and conversational-mode details to the RAG Inspector.
- Added multi-session persistent chat history with active-session restoration across browser restarts.
- Added a collapsible chat-history sidebar with grouped sessions and per-session deletion.
- Added session-scoped chunk inspection and non-destructive New Chat behavior.
- Updated answer generation to receive `<USER_MEMORY>`, `<CHAT_HISTORY>`, and `<POLICY_CONTEXT>`.
- Updated project documentation for the conversational RAG architecture.

#### In Progress
- No implementation work is currently in progress.

#### Known Areas to Review
- Validate memory extraction for ambiguous or repeated user statements.
- Add automated tests for intent routing, query rewriting, memory deduplication, and retrieval fallback.
- Confirm routing behavior across available Gemini model variants.

## Future

### Planned

- [ ] Add automated unit and integration tests.
- [ ] Add a reload or re-ingest action for replacing the policy file through the UI.
- [x] Persist chat history in a database or browser storage (browser `localStorage` + optional Supabase `chatbot_sessions` / `chatbot_messages`).
- [ ] Connect `DB_LOOKUP` intent routing to live employee leave-balance and attendance database queries.
- [ ] Add source citations that preserve section names without exposing raw chunk formatting.
- [ ] Add an administrator view for policy index status and index rebuild history.
- [ ] Add access control for employee-only deployments.
- [ ] Add analytics for unanswered questions and low-confidence retrieval.
- [ ] Improve mobile layout and accessibility.
- [ ] Add CI checks for build, lint, tests, and dependency security.
- [ ] Support deployment to a serverless or container platform.
- [ ] Add configurable retrieval thresholds and model selection.
- [ ] Add versioning for policy PDF updates and vector-store generations.
- [ ] Evaluate a managed vector database for larger policy sets.
