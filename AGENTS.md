<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project Agent Guidance

- Preserve the local JSON vector index, `gemini-embedding-001` embeddings, and NDJSON streaming protocol.
- Keep greeting and pleasantry handling separate from policy retrieval.
- Send recent `messages` and `longTermMemory` with chat requests.
- Use short-term history to resolve follow-ups; do not expose it as durable memory.
- Extract only durable role, department, location, shift-preference, or workflow-context facts.
- Never extract greetings or one-off policy questions into long-term memory.
- Keep persistent memory in `archemist_hr_user_memory` and deduplicate facts.
- Preserve New Chat behavior: clear short-term messages, but keep browser-persistent memory.
- Ground factual answers exclusively in `<POLICY_CONTEXT>`.
- Use `<USER_MEMORY>` and `<CHAT_HISTORY>` only for continuity and tailoring.
- Run `npm run build` after code changes.
- Update `README.md` and `Brag.md` for completed implementation changes.
