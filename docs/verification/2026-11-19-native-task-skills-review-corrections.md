# Native task skills: independent-review corrections

## Scope and disposition

The independent correctness, security, architecture and compatibility reviews identified five high, four medium and two low findings in the native-task-skills and document-date implementation. This correction lot addresses all eleven locally. The original review remains evidence about the implementation it inspected; this report records subsequent changes and their validation. No fresh independent re-review has been run.

| Reviewed defect | Correction and regression evidence |
| --- | --- |
| Stored publication metadata disappeared beside fresh HTML metadata. | Independent stored indications and HTML origins enter the same reconciliation. A timestamp derived from that HTML is no longer fed back as another indication. Compatibility aliases come exclusively from reconciled evidence; conflicting publication dates expose both origins and no confident alias. |
| Equivalent EOF pages bypassed repetition settlement. | Read identity clamps the limit to the remaining lines after the offset. The real mission loop now admits one canonical page and reaches repetition stop for equivalent EOF requests, as it already did for first-page aliases. |
| A dateline spanning read pages stayed unknown. | Initial date extraction examines the verified acquired representation while the returned excerpt, range, continuation and documentary progress remain paginated. A split-dateline workflow regression reads both pages, verifies exact reconstructed text and retains the date without reacquisition. |
| Historical alias-only continuation lost an event conflict. | Historical publication/event aliases are converted into precision-preserving evidence before reconciliation with the next page. Current and historical representations both retain competing event dates and omit the confident event alias. |
| Beyond-EOF offsets became uncertain effects. | Admission rejects offsets beyond the immutable resource's final line before the scheduled reader runs. The mission-loop regression receives typed `invalid_operation_input`, successfully reads a valid page, saves a program and completes without an uncertainty block. Genuine unknown-effect handling is unchanged. |
| Malformed paths threw ordinary URL errors. | Only URL-construction `TypeError` is translated to typed invalid input; unexpected resource failures still propagate. The same invocation-level recovery test proves corrective feedback, a successful next read and persisted framing. |
| Business Wire parsing had quadratic backtracking. | The prefix consumes any earlier dash run; one separator immediately precedes the fixed marker. The two overlapping unbounded repetitions are removed, preserving the anchored dateline grammar. A deterministic regression preserves independently attributed dates and rejects a malformed marker. Controlled before/after measurements verify the CPU effect. |
| Compatible indications triggered pairwise reconciliation. | Conflict detection uses distinct calendar days and instant timestamps with linear work. Pure regressions preserve equivalent instants with different offsets, distinguish incompatible instants and retain independent origins. Existing consumer regressions exercise the real shared owner. |
| Newer-package retention proof was overstated. | The existing persisted Sources mission test now introduces a separately valid package ID with different resource bytes before reopening and forced native compaction. The newer package is resolvable, but the resumed mission rereads the exact original annex value. The test registry is restored afterward. This is added characterization coverage, not a reproduced package-selection bug. |
| Current instructions parsed retained prose to remove methods. | Sources composes shared authority/completion instructions separately from its retained method. Workbench supplies its retained example explicitly to the common rule composition. Exact historical Sources 4 and Workbench 6 instruction/method hashes were characterized before refactoring and remain unchanged. |
| Relative-read guidance named the wrong root. | The operation describes the bound skill directory as the relative base, matching both native catalogue guidance and admission. Native input profiles were regenerated through their existing owner after this tool-description change. |

## RED and focused validation

Before production repairs, the public-context regressions failed for lost independent publication metadata, a split dateline and a historical event conflict. The current-format event-conflict control passed. An initial SEC fixture lacked required issuer metadata and failed at setup; after correcting that fixture, its historical case failed at the intended conflict assertion. That setup failure is not counted as RED evidence.

Before reader repairs, both invalid-input invocation tests stopped after the first provider response instead of completing corrected work. The equivalent-EOF regression admitted sixteen read requests instead of one. An initial EOF test used limits already beyond the entire file length and therefore did not expose the defect; the corrected test varies limits beyond the remaining extent but below the full file length. The admission outcome assertion uses the established typed `unavailable` contract rather than assuming it is a `refused` variant.

The RED commands were `pnpm exec vitest run src/__tests__/convex/integrations/workbench-public-context.test.ts -t 'independent stored|split across|historical aliases'`, a corrected historical-only rerun, and `pnpm exec vitest run src/__tests__/convex/execution/agent-skills.test.ts -t 'equivalent skill pages|invalid native read'`. The historical instruction characterization passed before refactoring. A timestamp-offset regression also caught and corrected an intermediate linear-time implementation that compared lexical days even when both indications represented the same instant.

After correction, 175 tests passed across ten affected suites covering skill delivery/recovery, dates, public-context acquisition, Sources retrieval, normalization, operation conformance/contracts, Workbench continuity/native interfaces and Sources compaction. A separate seven-test capacity/profile suite regenerated and verified the native profiles. Focused lint passed; final aggregate validation is recorded below. Counts overlap with later aggregate runs.

## Parser cost verification

The same module entry point was measured before and after the change with identical inputs, warm-up and three alternating runs. The table reports process CPU time; raw evidence also retains elapsed wall time. Other repository checks ran concurrently, so wall time is not used as a production latency estimate. Results were equal for each measured input. The retained real-data input was the normalized, frozen NVIDIA H20 SEC fixture already owned by the evaluation workflow. No timing assertion was added to CI.

| Input | Size | Before CPU median | After CPU median |
| --- | --- | --- | --- |
| Malformed Business Wire marker after a dash run | 64,015 bytes | 3,397.815 ms | 0.235 ms |
| Independently prefixed compatible datelines | 406,889 bytes; 8,000 indications | 1,182.735 ms | 68.420 ms |
| Normalized frozen NVIDIA SEC capture | 5,073 bytes | 0.073 ms | 0.065 ms |

These local measurements establish the observed correction, not a production exhaustion threshold or general model-quality improvement. Raw commands, pre-change module snapshot, reproduction logs and benchmark output are local task evidence; they are not linked from tracked documentation.

## Final validation and limits

Local synchronization to the verified `local-aboul_panga-dd_proto` deployment at `http://127.0.0.1:3210` passed Node bundling, generated bindings, TypeScript and schema validation. Worker admission was held with zero active writers/live leases, then released after publication; the existing backend and watcher were preserved. The changed failure cases were exercised through deterministic real-collaborator tests, not repeated as live deployment probes. The final `pnpm check` passed: skill-package consistency, documentation/design, both TypeScript projects, lint/import/execution/resource checks, formatting, 226 protocol tests, 3,326 Vitest tests across 354 suites and the production build. The initial aggregate attempt stopped on a missing optional-field narrowing assertion in a new test; after correcting that test assertion, the complete aggregate passed. Documentation checks were rerun after finalizing this report. Existing archive-size, CSS lint, technical-document word-count and build chunk-size advisories remain non-blocking. No paid providers, browser journey, cloud deployment, commit or push is part of this lot. Deterministic tests verify the reported workflows and correction paths; they do not establish general semantic reliability. Independent review of the corrected implementation remains unrun.
