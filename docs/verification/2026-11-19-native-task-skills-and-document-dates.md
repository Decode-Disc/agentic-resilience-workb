# Native task skills and document dates verification

Date: November 19, 2026. Implementation is uncommitted on `sources-workflow-no-legacy`, over `5d7e35b176f32045df40ad83c5751192809cbdff`, with the pre-existing working changes preserved. Technical feature checks pass; repository-wide CI remains red as described below. Semantic improvement has not been measured. Current obligations belong in [TECH](../../context/TECH.md#native-task-skills-and-dated-observations); delivery status belongs in [ROADMAP](../ROADMAP.md#phase-6--framing-and-controlled-transition).

## Delivered mechanisms

Workbench 7 and Sources 5 receive only their mission's native Pi catalogue and an admitted `read` operation. Workbench 4/5/6 and Sources 4 retain their methods without skills. Runtime methods live under `agent-skills/`, including complete worked cases and one shared documentary reference. Developer skills are excluded. Native discovery and catalogue formatting produce an immutable package; native reading runs in the Node action through the shared scheduled-operation lifecycle, with no host filesystem fallback or separate conversation engine.

The package ID is `research-methods-v1`, with hash `59636638f6fe940ad73678c9432fcdeb1deb910a16720a26fe327cf0bfd792e9`. Workbench's method resource hash is `886bdae7ff761c787cb8aeab84b855d5ab65a0a0a32bd8fe01e691d11c7ffd4d`; Sources' is `7be569582d442d8dc59055151e82e68b194d22a3da94529e79cfe964aafdd7c4`. Missing, modified or unadmitted resources fail explicitly. Package IDs do not fall forward on resumption.

Both documentary paths use the same date representation. Publication, filing and event dates retain origins and available precision; incompatible indications remain conflicts, and missing dates remain unknown. Narrative mentions do not become publication evidence. Continuations retain earlier evidence without treating compatibility aliases as fresh metadata. Conflicting date kinds cannot supply a confident compatibility date.

The already-installed Pi Coding Agent 1.5.0 was verified against its exact official npm registry record and promoted to runtime dependencies using `sfw pnpm add --save-prod @earendil-works/pi-coding-agent@1.5.0`. Pi Durable and Pi AI were not upgraded.

## RED and GREEN evidence

| Contract | Observed RED | Final evidence |
| --- | --- | --- |
| Captured CCC release datelines | `pnpm exec vitest run src/__tests__/convex/integrations/workbench-public-context.test.ts -t 'explicit release datelines'`: both readings returned undefined structured dates. | The October 29, 2026 GlobeNewswire abbreviation and July 30, 2024 Business Wire dateline produce exact day evidence; event dates remain unknown. |
| Sources metadata and conflicts | Documentary consumer tests first lacked `dates`; the conflicting capture retained a confident legacy publication alias. | Verified capture identity is retained, both origins remain visible and conflicting legacy aliases are null. |
| Native packaging | The packaging process was absent; later a top-level directory symlink was accepted. | Native metadata/duplicate-name rejection, missing annexes, child/root symlinks, escaping links, immutable-ID refusal and identical output from different authored-root paths pass. |
| Versioned bindings and phase controls | Current bindings were 6/4; a hidden post-framing read was admitted; version 7 focus was refused. | Defaults are 7/5, retained bindings resolve, post-framing reads are refused and focus behavior passes on 6 and 7. |
| Precision through continuation | A day-only dateline acquired fabricated midnight instant evidence; SEC filing metadata was marked as an instant. | Consumer regressions retain original day evidence and SEC filing meaning. Explicit HTML instants retain their real precision. |
| Consultation and repetition | Two method consultations consumed the no-progress allowance; equivalent paths produced separate resource requests. | A successful newly admitted context page preserves the existing counter without documentary progress. Canonical page identity makes repeated reads count toward repetition, including relative/absolute path and omitted/explicit first-line aliases. |
| Initialization and current exports | The full suite exposed an undefined reader operation under some import orders and simulator overrides targeting the retained Sources binding. | Reader composition now happens in the catalogue after definition initialization. The established `sourcesDefinition` export remains current, while Sources 4 is explicitly retained. Approval, operation-contract and recovery regressions pass. |

The final feature battery passed **238 tests across 19 suites**: agent skills, document dates, public-context integration, source retrieval, documentary metadata, HTML normalization, operation conformance/results, approvals/recovery, Sources completion correction/freshness, Workbench native interface/completion/continuity, separated contexts, Sources compaction and native profile identity/capacity. The packaging command `node --experimental-strip-types --test src/__tests__/config/agent-skill-packaging.test.mjs` passed both process-level tests, including their adverse cases.

Native provider-boundary tests use the real mission loop, serialization, scheduled reader and persisted Pi storage with deterministic external responses. Both missions receive method and annex bytes in subsequent requests. Workbench receives publication conflict origins; Sources receives the same date meanings from verified capture text. Sources reads its method and annex, closes/reopens the persisted harness, undergoes forced native compaction, then rereads the identical pinned annex value. A newer test package does not replace the retained definition's bytes. Native pagination text matches the operation result exactly; a stale generation cannot read scheduled input or adopt a late native result. The raw late success remains an unadopted audit observation; preparation state does not advance.

All six admitted skill/resource combinations were also read with the installed native API. The largest complete serialized operation value was **2,587 bytes**, within the existing **65,536-byte** result policy. No new resource limit was introduced. Native input profiles were regenerated only through the existing `UPDATE_PI_INPUT_PROFILES=1` capacity-test owner.

## Deployed local execution

The latest backend passed `pnpm convex:sync --url http://127.0.0.1:3210`, including Node bundling, generated bindings, TypeScript and schema validation. The running backend and watcher were preserved. This proves local deployment only; cloud publication was not attempted.

Each mission then performed a real admitted native read on that deployment, retained the package/resource pin and returned the expected method bytes. Corpus, source and preparation snapshots matched before and after; `/etc/passwd` returned `refused` with `skill_resource_not_allowed`. Pi worker admission was held during these model-free probes, so the fixture could not engage a model. Task-owned browser-test contexts were closed, `E2E_FIXTURES_ENABLED` was removed and worker admission was released. No browser or local E2E suite was used.

## Repository-wide limits at initial verification

`pnpm check` passed skill-package checking, documentation/design checks, typechecking, lint, imports, execution ownership and resource-policy checks before stopping at formatting. Five unmodified frontend/presentation files have formatting errors. Existing archive-size and CSS lint advisories were also reported; immutable archive records were not reformatted.

The separately executed full test command ran 3,315 Vitest tests: 3,274 passed and 41 failed. The feature's date assertions, binding initialization and current-export failures were repaired and their affected suites rerun successfully. A bounded rerun of the remaining four suites still reports **23 failures and 44 passes**: the SDK study, legacy source-preparation workflow, final-pass workflow and phase-4 workflow suites. The SDK `finish_reason_invalid` case also fails in an isolated task-start copy. A legacy case also fails in that copy, but at a different platform-initialization prerequisite; its exact failure causality is not established. Current legacy workflow diagnostics record `source_actions_v4` with `invalid_output`. These remaining failures were not silently reclassified as passing or repaired outside this task's scope.

`pnpm build` passed. The build's TanStack import-protection timing message is advisory. The complete repository test suite was not rerun after the bounded repairs; the final 238-test feature battery and affected-suite reruns are the final code evidence. GitHub browser CI remains unverified because no push was authorized.

## Independent review and disposition

One fresh native Codex code-reviewer session, GPT-6.1 Sol with xhigh reasoning, reviewed the task against its starting snapshot and accepted design. It requested changes for premature repetition stops, fabricated precision, version-7 focus refusal and top-level symlink admission, and identified missing technical proofs. All four code findings have failing regressions and passing corrections. The missing serialization, recovery, immutable-package, pagination/capacity and deployed-reader proofs were completed. Additional failures found by the full suite were corrected locally through their existing regressions. No second review was dispatched; no minor finding was deferred.

The execution skill's task-start helper referenced a missing sibling script directory. A persistent local ledger and direct commands replaced that bookkeeping helper; no commit was created. The conditional-provenance fixture that already failed at task start was supplied an explicit matching analyst activity so it exercises its intended valid condition-association contract without weakening the assertion.

The documentation review keeps the task methods and shared distinctions in their registered runtime owners, examples as history, current mechanisms in TECH and delivery state in ROADMAP. The dated design retains its rationale with a supersession note. PRODUCT and ADRs were not changed.

The [separate qualification protocol](native-task-skills-qualification-protocol.md) defines 12 cases per arm and records the missing evaluator binding needed to prove control/treatment capability parity. No paid qualification, semantic-improvement claim, commit, push or cloud deployment occurred. At initial verification, repository-wide validation was blocked by the recorded failures; the follow-up correction below records their disposition.

## Follow-up correction of the remaining failures

The remaining 23 failures shared one mocked HTTP protocol mismatch. The structured-output transport uses `streamText`; the installed OpenRouter provider sends `stream: true` and parses SSE chunks. These four suites instead returned plain JSON chat completions, leaving the finish reason unresolved and causing `invalid_output`, retries and failed preparation outcomes. The correction reuses the existing `streamingModelFetch` / `providerFixtureResponse` test helpers at the external boundary. Assertions, frozen request hashes, budget checks and production behavior are unchanged.

Before correction, the focused source-reading journal test failed with `unavailable` instead of `qualified`, and the completed SDK study failed with `finish_reason_invalid` instead of succeeding with its provider-reported charge. After correction, all 67 tests across the four affected suites pass, including every previously failing case. Biome corrected the five formatting errors without changing behavior.

The complete `pnpm check` subsequently passed: native skill-package consistency, documentation/design checks, both TypeScript projects, lint/import/execution/resource-policy checks, formatting, 226 protocol tests, all 3,315 Vitest tests across 354 suites, and the production build. The Vitest run took 416.70 seconds with four workers. Documentation checks were rerun after this report and ROADMAP were updated. Archive-size, CSS lint, technical-document word-count and build chunk-size advisories remain non-blocking. GitHub browser CI and paid semantic qualification remain unverified; no commit or push was made.

## Independent review and subsequent corrections

A later four-lane independent review found five high, four medium and two low issues despite the earlier passing aggregate. The [correction report](2026-11-19-native-task-skills-review-corrections.md) records their disposition, regressions and remaining verification limits. The earlier technical-delivery and repetition/date claims must be read with those findings and corrections; the originally claimed newer-package proof was absent until this follow-up added it.
