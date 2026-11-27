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

&#x09;		





