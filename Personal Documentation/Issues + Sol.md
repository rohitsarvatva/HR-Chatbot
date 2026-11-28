##### **ChatBot** 

( https://hr-chatbot-lime.vercel.app/ )



Prb-1
- Its very slow , taking long time to ans .
- Unnecessary Query Rewritting
Sol
- Added "Need Query Rewritting" function.  

\- Only rewrite the query if context is missing , else NO.
- added Gemini-flash models to answer fast.




Prb-2

\- Vercel deployement :-	-Gemini api key missing

&#x09;		-could not parse / read Pdf properly

&#x09;		-wrong AI Model.

&#x09;		-large Chunking







Prb-3

\- Unnecessary Long Answers.

\- flash models directly ans without thinking, thus giving unnecessary info.

Sol
- **Dynamic Formatting** - Ans according to the que
short direct ans = 1-2 line crisp answer 
long context ans = Context based answer





Prb-4

**- Passing Marks (minScore)**
Set too low at 0.35. Because your Step 1 prefix adds "Archemist HR policy rules..." to every query
, almost every paragraph in the PDF looked slightly related and passed the filter.
**- Seat Limit (topK)**
Set to 5. For a simple question like "office timing", Gemini was handed 5 different 
policy paragraphs and felt pressured to summarize all of them.
**- Gemini's Writing Style
-** Without strict scope rules, Gemini treated the retrieved paragraph like a checklist—dumping office timings, login rules, and late-mark penalties all at once.

Sol
**- Passing Marks (minScore)**
Raised to 0.55. Weak, loosely related paragraphs are blocked immediately, so only truly relevant sections reach Gemini.
**- Seat Limit (topK)**

Lowered to 3. Gemini only receives the top 1–3 strongest matches, cutting out background noise.
**- Gemini's Writing Style**
Set temperature: 0.1 and added Adaptive Scope rules: Gemini now extracts only the exact lines answering your 
question—giving 1–2 lines for simple facts and bullet points only when a full process is asked.



Prb-5 (Part 3 — NLP & Routing)
- Plain keyword matching missed grammatical variations ("deducting" vs "deductions") and fast-typing typos ("attandance", "reimbursemnt").
- Fragile regex-only chitchat detection could not cleanly separate general small-talk, policy questions, personal DB queries, and out-of-scope prompts.

Sol
- **Porter Stemming + Jaro-Winkler Fuzzy Matching (`lib/nlp-matcher.js`)**: Precomputed `chunkStems` on vector-store load and upgraded hybrid keyword scoring (capped at `+0.15`) to match exact stems or fuzzy similarity `>= 0.90` (for stems `>= 4` chars).
- **Serialized Naive Bayes Intent Classifier (`lib/intent-classifier.js`)**: Built a PDF-driven 4-class training pipeline (`npm run intent:generate` + `npm run intent:train`) using shared unigram + bigram stemmed features (`lib/intent-features.js`) across `POLICY_RAG`, `CHITCHAT`, `DB_LOOKUP`, and `OUT_OF_SCOPE`, restored from `data/intent-model.json` at startup. Confirmed `CHITCHAT` (`>= 2.0x` margin) fast-paths in < 1 ms without calling embeddings or Gemini.


