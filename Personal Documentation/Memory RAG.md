##### **RAG HR-CHATBOT**

&#x20;

\[Current Query] ──► \[Embed Query] ──► \[Search JSON Index] ──► \[Top-K Chunks + Query] ──► \[Gemini Answer]



Conversational RAG (RAG with Memory) means teaching the system to understand follow-up pronouns and context

(e.g., User: "How does multi-tier leave approval work?" $\\rightarrow$ Follow-up: "What if the approver is on leave too?").





\[Chat History (Last N turns)] + \[Current Query]

&#x20;                   │

&#x20;                   ▼

&#x20;  1. Query Contextualizer (Fast LLM Call)

&#x20;     Rewrites ambiguous follow-up into a standalone search query

&#x20;                   │

&#x20;                   ▼

&#x20;  2. Vector/Hybrid Retrieval (Using Standalone Query)

&#x20;                   │

&#x20;                   ▼

&#x20;  3. Answer Generator (Gemini)

&#x20;     Receives: System Prompt + Retrieved Chunks + Chat History + Current Query

&#x20;                   │

&#x20;                   ▼

&#x20;  4. Memory Store Update (Save Turn)







**Speed Issue** 

* Why That Happened (Two Things)Unnecessary LLM Rewriting on Standalone Queries:

"tell me about official shift timings." is already completely self-contained—it has zero pronouns (it, that, they, he) and doesn't depend on "hi". Yet your router still triggered a full LLM rewrite call, adding 1.5–3 seconds of extra latency before vector search even started, and then the second LLM call sat stuck at "Searching HR policy..." waiting to stream.Double Greeting



* Bubble Bug:

Notice in your screenshot that "Hello! I am your Assistant. How can I assist you today?" appeared twice—once as the initial welcome message, and again after "hi", which polluted your chat history (messages.length > 1) so the backend mistakenly thought "tell me about official shift timings." was a follow-up question.



**How to Fix Both for Instant Speed**

1\. Only Rewrite When Context Is Actually Missing (Zero-Latency Guard)

Embeddings (gemini-embedding-001) already handle conversational phrasing like "tell me about..." or "can you explain..." effortlessly without rewriting. Only trigger the LLM query rewriter when both conditions are true:



There is at least one prior POLICY turn in history (ignore "hi" / chitchat turns).

The new query actually contains ambiguous references (pronouns like it, this, that, they, he, she, those, or short follow-up starters like what if, and what about, explain step, summarize).





Exclude Greetings from chatHistory Sent to the Router

Filter out CHITCHAT messages when building priorPolicyMessages so saying "hi" never tricks the bot into thinking a real conversation has started.

**Part 3 Update (Naive Bayes Intent Router)**

- Step 0 now runs `classifyIntent(question)` (`lib/intent-classifier.js`, restored from `data/intent-model.json`) in < 1 ms before context rewriting or embeddings.
- Confirmed `CHITCHAT` (`>= 2.0x` margin) exits immediately on a fast-path without calling `gemini-embedding-001` or `routeAndRewrite`.
- `buildPriorPolicyMessages` also uses `classifyIntent(message.content).intent === "CHITCHAT"` alongside cited-chunk checks to keep casual turns out of policy follow-up history.













