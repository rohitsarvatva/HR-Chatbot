#### **How NLP Makes Your Chatbot Smarter**



###### Implement It in Next.js / Node.js



**npm install compromise natural**

compromise (\~250 KB): Rule-based parser that extracts dates, numbers, nouns, and verbs with zero model files.

natural: Classic Node NLP toolkit providing Porter/Lancaster stemmers, tokenizers, TF-IDF, Jaro-Winkler fuzzy spell-matching, and Naive Bayes classifiers.





**Upgrade Keyword Scoring with Stemming \& Fuzzy Matching**

Replace raw string matching with Porter Stemming + Fuzzy Distance:



1. **Porter Stemming** (Chopping Words Down to Their Root)

A fast, rule-based algorithm that strips common suffixes (-ing, -ed, -s, -es, -ation, -ly) off words to reduce variations to a single root "stem."

eg : -	"leaves", "leaving", "leaved" --> "**leave**"

&#x09;"deductions", "deducted", "deducting" --> "**deduct**"

**Why it helps your RAG bot:** If your HR policy says "Leave deductions apply after 3 late marks" and a colleague types "Are they deducting my leaves?",

plain string matching sees zero overlap ("deducting", "deductions", "leaves", "leave"). After Porter Stemming, both turn into \["deduct", "leave"]—giving you a 100% match.



**2. Fuzzy Distance** (Catching Typos \& Spelling Slip-Ups)

What it is: A mathematical score measuring how similar two strings are character-by-character, allowing small typos to still count as a match.

How it scores real typos:"attendanc" (stemmed from "attandance") vs "attend" --> \~0.89

&#x09;		 "reimburs" (stemmed from "reimbursemnt") vs "reimburs" --> 1.00

&#x09;		 "leave" vs "lunch" --> \~0.53 (rejected cleanly)

**Why it helps your RAG bot**: People typing fast on Slack or mobile web apps regularly mistype words like "attandance", "probabtion", or "reimbursemnt".

Stemming alone can't fix a typo because "attandance" doesn't follow normal suffix rules—so Jaro-Winkler catches it right after stemming.



Step 1 Stemming solves grammar variations (plurals, tenses).

Step 2 Fuzzy Distance solves human spelling errors on whatever stems didn't match exactly.





##### **Implemented Naive Bayes Classification Algorithm (Part 3)**

**4-Class PDF-Driven Training Pipeline:**

1. `scripts/generate-intent-data.js` (`npm run intent:generate`) reads all 18 chunks from `data/vector-store.json`, asks `gemini-3.1-flash-lite` to generate 3 realistic employee questions per chunk (short, natural, and specific rule), and saves a balanced 144-sample dataset (`data/intent-dataset.json`: 36 samples each across `POLICY_RAG`, `CHITCHAT`, `DB_LOOKUP`, and `OUT_OF_SCOPE`).
2. `lib/intent-features.js` extracts shared **Porter-stemmed unigram + bigram** features (keeping stopwords so short phrases like `"who are you"` and `"my leave balance"` keep their discriminative signal).
3. `scripts/train-intent.js` (`npm run intent:train`) trains `natural.BayesClassifier` on those features and serializes the model to `data/intent-model.json`.
4. `lib/intent-classifier.js` restores `data/intent-model.json` once at server startup (`natural.BayesClassifier.restore(...)`, with safe in-memory fallback) and applies runner-up margin guardrails (`>= 2.0x` for `CHITCHAT`, `>= 1.5x` for `OUT_OF_SCOPE`, `< 1.05` ambiguous default to `POLICY_RAG`).

**How they work together in a single system — Sequential / Waterfall (What Your Bot Does Right Now):**

Your Naive Bayes model runs first (< 1 ms) as a bouncer at the door inside `app/api/chat/route.js` (`[IntentRouter]`):

- **If it's `CHITCHAT`** (with `>= 2.0x` margin): Naive Bayes handles it immediately on a fast-path and stops there—neither `gemini-embedding-001`, vector search, nor `gemini-3.1-flash-lite` runs.
- **If it's `POLICY_RAG`** (or a mixed greeting + policy question like `"hi, what does the studio policy say about leaves?"`): Naive Bayes hands the baton over to `gemini-embedding-001` + hybrid retrieval + `gemini-3.1-flash-lite`, so both models collaborate—Naive Bayes classifies the intent, and Gemini generates the grounded answer.
- **If it's `DB_LOOKUP`**: Currently passes through to RAG while logging `[IntentRouter] intent=DB_LOOKUP`—ready to hook directly into Supabase employee attendance/leave queries next.
- **If it's `OUT_OF_SCOPE`**: Classified and logged with a `>= 1.5x` margin; currently passes through to hybrid search where the `0.55` threshold blocks irrelevant chunks and returns the natural fallback without invoking Gemini answer generation.

An LLM can do classification, retrieval, and writing all by itself—but making an LLM act as a greeting detector is like hiring a senior architect to open the office front door. Using your tiny Naive Bayes model for instant routing and reserving Gemini for reasoning and writing gives you sub-50ms replies on simple turns, lower API costs, and full LLM intelligence whenever real policy synthesis is needed.

