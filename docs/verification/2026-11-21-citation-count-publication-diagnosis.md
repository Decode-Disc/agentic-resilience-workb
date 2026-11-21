# Citation-count publication diagnosis and evaluator correction — 2026-11-21

## Result and scope

The coverage-preset assertion in the evaluator is corrected and covered through the real scenario runner, including submission of the following analyst consultation. The misleading Workbench citation claim is reproduced through the real native Pi, receipt, response-control and publication path with synthetic provider responses. Its cause is confirmed, but its publication policy is not changed by this correction. No paid model call, new qualification lot, backend publication, browser check, dependency change, commit or push was performed.

The inspected worktree is `refactor/documentary-engine`, HEAD `a326030371e5546dabc5820ad58715753fc77ab1`. The relevant publication modules match the frozen paid candidate `7cd02bb17fb7637d4404277ace3d48f5370e9c31c452c6fe3851a8957cafcb7f` byte for byte. The [replacement qualification report](2026-11-21-documentary-qualification-replacement.md) preserves that lot's results and limits; its official failed assessment is unchanged.

## Which automatic checks ran

| Check | Retained evidence |
| --- | --- |
| Automatic campaign review | Not authorized or run: the last mandate is version 2 with manual assessment and no analysis mandate. The existing version-3 review mechanism was not exercised. |
| Workbench semantic response control | Disabled in the policy pinned to the relevant invocation: revision 0, `enabled: false`. No `check_response_coherence` operation exists in the first dossier's complete operation export. |
| Sources documentary control | One automatic documentary control reviewed twelve contributions. That control concerns the source contributions, not the final Workbench publication. |
| Deterministic execution/publication checks | Active. These enforce receipts, authority and the closed research-status vocabulary; they do not validate arbitrary prose about the number of cited questions. |

## Tight feedback loops

The evaluator regression was run RED before production modification:

```sh
node --experimental-strip-types --test --test-name-pattern='omitted coverage preset' src/__tests__/config/qualification-v2.test.mjs
```

It failed with the original comparison: actual `balanced`, expected `undefined`. After correction, the full test file passed all 41 tests with no skips. Four cases cover an omitted default, an explicit nondefault, an incorrectly changed default and an incorrectly changed explicit preset. Successful cases retain the full framing handoff and submit the following consultation; mismatches preserve the failure and prevent that consultation.

The native diagnostic is retained outside the default suite as an explicitly unresolved reproduction, not an accepted regression contract:

```sh
pnpm exec vitest run --config .local-runtime/citation-count-diagnosis/vitest.config.ts
```

This approximately five-second, network-isolated command creates five questions, commits public associations for q1/q2/q4/q5 through production document and framing owners, then replays the provider claim that all five are cited. It asserts the actual delivered assistant message and fails with:

```text
All five questions cite the passages I actually read.

Framing saved. The event remains open. Public citation recorded for conditional questions.
```

Publication is verified to contain one assistant message with `responseControl.status: not_checked`, and no coherence-check operation. Repeated runs reproduce the same failure. A control run changes only the synthetic provider draft to “Four of the five questions have recorded citations; q3 has none.” and passes the same publication assertion. That control demonstrates a discriminating reproduction; it is not a production fix or evidence that a real reviewer would detect this error.

## Confirmed citation failure mechanism

Three hypotheses were checked against the retained actual input, raw reply and publication: loss of per-question detail, a changed saved state, and a model contradiction allowed through publication. The first two do not explain this case.

Invocation `jn71yfh2agva3s8s9b19w59bkh8jn357` contains Workbench 11 framing revision 2 with question IDs q1–q5 and `publicCitations.conditions` for q1/q2/q4/q5. Its successful write receipt contains the same four associations. The serialized request hash is `e01128ed23de19ff52c06ed029f57389440155f6224691bfd0eadf2f6312eff9`; it was checked against the retained bytes. The raw provider reply already contains the false “All five” claim. The delivered message's hash matches the committed mission result, including that claim. The model's internal reason for generating the generalization is unknown; authoritative detail was available.

At [responseControl.ts](../../convex/responseControl.ts), disabled policy makes semantic review ineligible. In the absence of a closed research-status conflict, completion records `controller_disabled` and `not_checked`, then permits publication. At [workbenchAgent.ts](../../convex/domain/workbenchAgent.ts), completion retains the model explanation and adds confirmations. At [workbenchAgentOperations.ts](../../convex/domain/workbenchAgentOperations.ts), the truthful confirmation describes the presence of public citations for conditional questions, without validating every sentence of the explanation. Consequently, a correct receipt and a true generic confirmation coexist with false explanatory prose.

The earlier receipt correction delivered the precise saved facts. It did not make arbitrary model-authored claims about those facts authoritative or verified. The partial-membership publication case was absent from the inspected receipt/publication regressions. A generic confirmation alone cannot establish truthfulness of the complete message.

The existing semantic coherence mechanism is the relevant owner for broader wording; its current contract is optional and advisory. Enabling it has not been shown to detect this particular claim, and advisory review can still publish with a visible reserve after bounded correction or unavailability. Requiring stronger publication behavior would change that policy and needs an explicit design decision. No phrase-specific count filter, extra prompt instruction, automatic policy activation or new reviewer framework was introduced.

## Evaluator correction and full recorded replay

The old assertion compared `sources.coveragePolicy.preset` with optional `scenario.coveragePreset`. The seed owner correctly resolves an omitted preset to `balanced`; the actual terminal snapshot contains `balanced` on both the dossier and Sources. Its fixed framing ID also matches. Thus neither a lost Sources preset nor a wrong framing snapshot caused the failure.

The [scenario runner](../../scripts/evaluations/workbench-browser/scenarios.ts) now compares an explicit requested preset when supplied, otherwise the dossier's persisted preset. It reuses the resolved owner instead of duplicating the `balanced` default. Genuine mismatches remain failures.

The original complete NVIDIA scenario was additionally replayed through the corrected runner using the retained before-Start and completed-Sources backend responses, with network access replaced by a failing boundary. It verified the actual seven-question framing, eight needs, `balanced` coverage and submission of the exact previously unsent analyst request. That deterministic caller replay passed; it does not retroactively qualify the live post-Start answer that the paid lot never generated.

## Verification and evidence retention

Passed: 41 Node protocol tests; four focused default/explicit/mismatch cases; the full recorded scenario replay; frontend/tooling TypeScript checking; scoped Biome; import checking; and task-path whitespace checking. The native negative publication diagnostic remains intentionally RED and separately disclosed. Its truthful-draft control passes. Temporary diagnostic logging was removed. Production Convex modules and their default tests were not modified.

A marked local diagnostic harness imports production modules and mocks only external I/O; its fixture, configuration, reproduction logs and live-input proof are preserved in the supplemental archive. Existing qualification archives and raw artifacts remain unchanged. The [verified diagnostic archive](../../scripts/evaluations/archives/20261121T135131913Z-citation-count-and-coverage-diagnosis/record.json) preserves 20 files (157,790 bytes), including the exact runner/test correction, isolated reproducer and logs.

## Subsequent direct OpenRouter and Arize correlation

The initial diagnosis inspected retained native requests and replies. It had not independently compared those bytes with OpenRouter's trace broadcast in Arize. That comparison was subsequently completed using read-only access, without inference or a new qualification lot.

The direct OpenRouter generation lookup succeeded for `gen-1795266701-SrxiM0f9YjYOK6tOpWWE`. Arize contains the same generation in project `agentic-resilience-workbench`, trace `15d095320cb0dc4700848169349719be`, starting `2026-11-21T13:11:41.149Z`. OpenRouter reports normal `stop`, cancellation false, 29,380 native prompt tokens, 1,021 native completion tokens and confirmed cost USD 0.00215474. Its standardized token counts are different fields; they were not substituted for native counts.

An executable comparison passed for all nineteen observable input messages: roles, complete content, tool calls, tool-call identifiers and names match the locally retained request exactly. The visible completion matches all 4,227 characters of the locally retained model reply. The published mission result is that reply plus the generic framing confirmation, and its hash matches the delivered assistant message. This establishes the observable message/text boundary, not equality of every top-level provider wire parameter or private reasoning field. Private reasoning text and account/key metadata are excluded from the extracted evidence.

The eight generations of the first framing turn were then compared individually using their OpenRouter generation IDs and local provider receipts. All visible reply text and parsed tool-call IDs, names and arguments match. The generation sequence is acquisition/skill consultation, targeted search, three contextual reads, first framing proposal, corrected framing proposal, final explanation.

The decisive sequence is:

1. The first `adjust_framing` arguments already contain five questions with public citation associations only for q1/q2/q4/q5. The request is refused for a scope-anchor mismatch.
2. The next generation preserves the question content and event basis, including the same four associations. The scope is changed; the operation succeeds at revision 2.
3. The exact provider input for the next generation contains those four associations both in the successful tool result and in current framing. It also contains the instruction to describe completed changes only from their confirmed result.
4. That final provider completion nevertheless says all five questions cite the passages read. No fifth citation for q3 was proposed or lost. The first observed count divergence is in this final model explanation.

The framing skill was actually consulted and its returned text is present in the provider-visible conversation. There is no demonstrated instruction-delivery failure for this case. The comparison excludes lost citation detail and transport-side rewriting as explanations for the captured discrepancy; it does not establish why the model generalized four associations into an all-five claim. It also does not demonstrate that a different prompt or an enabled coherence reviewer would prevent it.

The [verified provider-trace correlation archive](../../scripts/evaluations/archives/20261121T150920815Z-citation-provider-trace-correlation/record.json) retains the correlation script, visible trace extracts, eight-generation comparison and selected OpenRouter metadata (10 files, 174,769 bytes).
