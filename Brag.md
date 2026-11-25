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

## Present

### 2026-11-23

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
- [ ] Persist chat history in a database or browser storage.
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
