# Analyst Language and Meaning

Use this procedure for text, badges, counters, status definitions, and action wording. The audience is an analyst researching a company, not an engineer operating the pipeline. Keep product copy in English. Use familiar research terms when they help the task; expanding every technical noun into a longer phrase can make the interface harder to read.

Prefer short, concrete sentences and verbs that name the analyst's action or the observed result. Avoid literal enum translations, unexplained abbreviations, and vague labels such as “processed” when the useful fact is that content can be read or a decision has been saved. Keep the same term for the same concept across surfaces. Check new-user comprehension without burdening repeated expert work with permanent instructions.

Read the relevant workflow in [PRODUCT.md](../../../../PRODUCT.md) and its enforcement in [context/TECH.md](../../../../context/TECH.md). The questions below check how those contracts are presented; they do not define a second glossary or new product rules.

## Trace the fact before naming it

Readable wording can still overstate what the system knows. Establish the supported fact before choosing its label, because a clearer sentence must not introduce a stronger claim. When a message or indicator changes, trace its input and resolve the following questions before writing copy.

For each changed message or indicator, inspect:

1. **Evidence:** Which persisted field, event, or query result supports it? Does that input distinguish the states the proposed text claims to distinguish?
2. **Meaning:** What can the analyst conclude, and what remains unconfirmed? Is this a category, a recommendation, a human decision, a processing result, or an analytical judgment?
3. **Use:** What decision does displaying it help? Does adjacent information already communicate it?
4. **Action:** What can the analyst actually do now, and what result will that action produce?

If the available projection cannot distinguish an unattempted source from a failed read, surface the missing contract. Do not manufacture that distinction from unrelated counters or write a more confident message over ambiguous data.

Keep semantic translation in the existing presentation owner. Inspect all affected callers, including help, accessible labels, empty states, and tests, so one correction does not leave conflicting explanations elsewhere.

## Check the distinctions that matter

Research progress, evidence and judgments can coexist on the same view. Keep their consequences understandable so the analyst does not mistake one for another. Use the relevant rows below when the changed information involves those concepts, and settle each question against the actual contract. The table is an inspection aid; it does not require displaying every distinction as a badge.

| Information being presented | Question to resolve from the real contract |
| --- | --- |
| Framing proposal | Is the scope still proposed or fixed for research? Could a proposed angle be mistaken for an established company fact or for research already started? |
| Inventory and question uses | What does the assertion establish, and how is it used for this question? Could a linked passage or Unknown be mistaken for an answered question? |
| Appraisal | Can the analyst identify the interpretation, its support, assumptions, objections and decisive unknowns? Does the view distinguish a proposal from a retained judgment? |
| Synthesis | Can the analyst trace a mechanism relationship to its reasoning and retained basis? Does result availability imply endorsement, or hide a material pending decision? |
| Included or recommended sources | Which set and revision does this describe? Could the analyst mistake selection for reading, factual support, or approval? |
| Reading and preparation | Was content saved, only partly obtained, not attempted, or unsuccessfully processed? What remains inspectable? |
| Documentary coverage | Is a useful contribution established, limited, absent after inspection, or not yet assessed? Does the data actually distinguish these cases? |
| Provenance, family, and document kind | Does the label identify author, host, filing venue, category, or document form? Which of those facts are independently established? |
| Counts | What objects are counted, from which scope, and under what qualification? Do the label and destination use that same population? |
| Human decisions | Which object and version did the analyst review, retain, correct or defer? Does a positive color imply a decision that has not occurred? Source-set approval applies only on the existing compatibility path. |

For example, several included regulatory candidates do not automatically mean several annual reports have been read and found useful. Check the actual matching population before naming a counter or linking its drill-down.

Likewise, linking evidence to a question does not justify “Answered.” Inspect the appraisal and its review state against [PRODUCT.md](../../../../PRODUCT.md); support may coexist with an unresolved objection or a decisive unknown. Label the established result and make its reasoning accessible rather than substituting a completion count for an assessment.

## Say what happened and what follows

Generic errors leave the analyst choosing a remedy that may not address the failure. Explain the task outcome and a usable next action so recovery does not require understanding internal execution. For an interrupted or limited operation, inspect its persisted outcome and available transitions before choosing the message or control.

For an interruption, lead with the affected task, explain its consequence for the analyst, and offer only an available next action. Distinguish a technical inability to assess material from a finding that the material is insufficient. Finding more sources, retrying failed discovery, and continuing preparation are separate intents; inspect the operation behind each control.

Illustrative wording, only when supported by the saved outcome: **“Source preparation interrupted. You can read 2 of 48 sources here. The remaining sources have not been assessed.”** Offer **“Continue preparation”** only if that transition is actually available. If recovery requires an operator intervention, explain the current limitation without inventing a working retry or exposing configuration details.

Avoid raw workflow keys, provider diagnostics, and internal identifiers in analyst copy. A disabled control needs a useful reason and available alternative, or a known waiting condition. Do not promise “Retry when available” without an observable way to know when that is.

## Reduce competing information

Several individually meaningful labels can repeat the same information in context. Give priority to what changes the analyst's decision, because displaying the model's entire taxonomy increases reading effort without necessarily adding insight. When metadata competes for attention, compare adjacent labels before renaming, removing, or disclosing them.

The presence of distinct backend fields does not justify displaying every field as an equally prominent badge. Compare the information gained by each label. Keep the details needed for the current decision visible, and move supporting classification or rationale into the established disclosure when appropriate. Preserve useful provenance and integrity disclosures.

“Primary regulator” beside “Regulatory” and a specific filing type illustrates this problem. Renaming one badge does not by itself resolve redundancy. Check whether the record establishes a filing or only an SEC-hosted URL before considering “Filed with SEC”; never replace an entire authority category with that phrase solely from its domain classification. Test the resulting composition with other source families and missing metadata.

Read the complete result as an analyst: what happened, what is available, what remains uncertain, and what can I do next? An explanation in the agent's handoff cannot compensate for an interface that leaves those questions unanswered.
