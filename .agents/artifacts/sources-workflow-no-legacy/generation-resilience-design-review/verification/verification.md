# Verification and Design Corrections After Oracle and Architect Review

## Outcome and scope

The user requested verification of the two reviewers' findings and corresponding updates to the [TDD](../../27-tdd-generation-resilience.md). Repository HEAD remained `168981b3c48a7d20062e39e2a2df71689c1036d4`. The original [review report](../review.md), reviewer reports and [frozen candidate](../tdd-reviewed.md) are preserved; their BLOCK verdict concerns that candidate. This follow-up verifies current mechanisms and specifies corrections. It is neither a new independent review nor evidence that the proposed recovery or migration has been implemented.

The accepted architecture, 4,096-character policy, cumulative resource authority and no-maintained-legacy requirement remain intact. No extra automatic third attempt, provider pin, parser, retry engine or economic-answer gate was added. Only the TDD and supporting evidence were retained as changes; temporary diagnostic test additions were restored byte-for-byte.

## Executable verification

Eight existing integration cases passed in 9.19 seconds across provider billing and Sources documentary control: confirmed billing with a still-started receipt, explicit expired-lookup recovery, factual late accounting after cancellation, changed-generation refusal, queued-job cancellation, adoption-only rebinding refusal, lost scheduled worker nonrestart and the provider-lease boundary. The name filter excluded 35 other cases; those cases were not executed in this run.

Five temporary characterization probes reused the existing Sources fixture, schema, real internal queries/mutations and the registered scheduled-action handler in a Convex action context. Provider HTTP was replaced. Acknowledgement loss was injected at the action-to-mutation transport boundary only after each real mutation committed. No internal domain result was mocked. The retained [probe source](probes.test.ts.txt), [results](results.json) and [restoration manifest](temporary-test-manifest.json) preserve exact commands, outcomes and test-prefix hash.

| Probe | Observed result | What it establishes |
| --- | --- | --- |
| Lose acknowledgement after `finishOneShot` | One successful provider receipt and retained invocation result; no qualification; operation unknown and mission blocked. | The current generic failure route does not recover the already committed one-shot result. |
| Lose acknowledgement after `retainControl` | One successful provider receipt and one qualification; operation unknown and mission blocked. | Domain retention can succeed before the exception route blocks the mission. |
| Lose acknowledgement after operation `recordResult` | One successful receipt, one qualification and recovered successful operation outcome. | Final-operation acknowledgement recovery already works; the correction must preserve it rather than treating every acknowledgement loss as broken. |
| Apply a receipt transition to a deliberately stale budget baseline | Persisted reserved count becomes -1 and incidents 2, with dispatches still 1. | Existing delta code assumes its stored baseline already uses the current classifier. This is a migration counterexample with explicitly seeded inconsistency, not evidence that production counters were observed negative. |
| Abandon a checking claim, then pass its retryAt and try the ordinary next claim | Claim remains checking at attempt 1; ordinary attempt 2 returns null. | The current ordinary claim cannot recover this abandoned lookup; existing explicit administrator recovery is separate. |

Four probes passed on the first diagnostic run. The lookup probe initially failed during setup because the buffered response fixture had not recorded a generation identity. The corrected fixture explicitly seeded that required observation; the unchanged post-claim assertions then passed in 6.79 seconds. The initial setup failure is recorded and is not a product RED result. The original integration file was restored to its recorded SHA-256 after these checks. All thirteen distinct executed cases passed; they were not one full-suite run.

## Finding-by-finding disposition

### Persisted accounting rebase: confirmed conditional transition defect

`readPreparationBudget` returns an existing stored budget immediately. `patchQualificationReceipt` derives before/after buckets using the installed classifier and subtracts/adds them against that stored budget; qualification usage applies the same delta pattern. Source inspection plus the stale-baseline probe confirms the consequence if classification changes without rebasing. Actual historical EOF cohorts and negative production values were not inspected.

The TDD now requires version-2 projection baselines, fenced writer drain, idempotent atomic conversion per run/context scope, conservative unexplained consumption and resumption of ordinary deltas only after all related projections are current. Its matrix covers repeated conversion, independent termination/cost updates and late settlement. No grant or financial-finality policy changes.

### Worker recovery timing: confirmed source-backed contradiction

Model receipt leases end at the minimum logical preparation/mission/request/qualification deadline plus settlement grace; they do not use the earlier action execution boundary. The existing lease integration test confirms the deadline-plus-grace formula. Therefore the former TDD instruction to arm useful recovery only against this receipt deadline could arrive after dispatch authority expired. Early-worker-death recovery itself remains unimplemented.

The TDD now retains the existing platform worker deadline independently, arms its owned wake at epoch admission and handles a pending return or terminal owned job without waiting for the financial fence. It preserves the original logical deadline and forbids replacing a live worker or an externally uncertain call.

### Lost-worker receipt closure: confirmed missing transition

`settleBilling` updates provider/billing evidence without closing a started receipt. The existing integration case observes that state; expired started receipts separately block qualification admission. `finishOneShot` also requires receipt settlement before adopting its structured result. Remote confirmation alone does not perform local closure.

The TDD assigns abandoned structured-attempt closure to invocation lifecycle, after worker fencing and matching termination proof. It first recovers a validated retained result or records explicit technical failure, uses the existing receipt/accounting transaction and retains unknown cost. The actual scheduled cancellation-without-cost replacement sequence remains a required implementation regression, not an executed success here.

### Acknowledgement-loss path: reproduced with an important boundary

The scheduled action's generic uncertain-effect route blocks before reading one-shot/control state, as the first two acknowledgement probes reproduce. The third proves that a final operation outcome already has recovery. The initial review was correct for the earlier commits; a blanket statement that acknowledgement recovery never works would be false.

The TDD now reaches retained-fact resolution through the real scheduled exception handlers before mission blocking, while retaining the existing final-outcome behavior. It requires current authority for new adoption/dispatch and prevents genuinely uncertain effects from being repeated.

### Epoch fencing and positive resume: confirmed specification gap

Current result/failure settlement checks generations rather than future worker epochs. Existing rebind updates adoption generation for engaged work, while Sources reservation and provider admission require the original expected dispatch generation. Existing integration cases verify that merely rebinding adoption does not start the old job.

The TDD now specifies the request/epoch/dispatch-generation/call relationship at admission, reservation, domain retention and both settlement paths. An admitted new epoch has explicit current dispatch generation; original invocation pins and request admission history remain unchanged. Paused reconciliation is factual only; ordinary resume must reclaim the slot before another attempt. Future obsolete-worker and successful-resume sequences are required tests.

### Abandoned reconciliation claim: reproduced; explicit recovery already exists

The ordinary claim probe confirms that expired checking cannot be reclaimed. The existing administrator test confirms the separate bounded manual recovery path. The missing behavior is automatic owned recovery while the same operation remains authorized, not a complete absence of recovery tooling.

The TDD now arms an expiry wake atomically with the claim, reclaims with the existing retryAt/attempt fence, and reads prior settlement before another lookup/continuation. After closure it preserves the existing late-accounting boundary rather than reviving inference.

### Retained bindings: confirmed owner mismatch; cohort feasibility still unverified

Stored conversation and mission versions drive resolution. Mission start reuses an existing objective, and Pi rebind changes generation rather than definition version. New defaults therefore cannot migrate retained owners; blindly rewriting missions also conflicts with retained-response version checks.

The TDD now maps idle conversations, paused Sources missions and historical terminal work separately. It names native writer/tail/task preconditions and preserves mission/objective/completion identity, transcripts, counters, deadlines and immutable invocation pins. An unsafe pending native checkpoint remains an explicit cutover blocker. No actual cohort inventory or native checkpoint migration was performed, so practical conversion feasibility is not claimed. No permanent legacy executor is allowed as a fallback.

### Historical examination representation: confirmed missing closed data shape

Stored documentary task output currently embeds its executable control validator, and consumers require that control. An old global verdict cannot supply complete per-need findings. This is a representation gap rather than a reason to keep a v1 executor.

The TDD now separates strict model output from the current stored `DocumentaryExaminationState`: examined current control or not-examined with an original observation reference and materialized historical contribution-level uses. Handoff references do not currently store those uses, so conversion computes them once through the original policy rather than requiring an old runtime validator to recover them later. They are explicitly historical, not new per-need approvals. The existing author/verification `documentaryAssessment` metadata is not repurposed. Frozen historical outcomes remain recorded outcomes; new use requires current examination. All readers consume one shared projection and the existing paged history.

### Third attempt: confirmed allowance ambiguity, not authority to expand it

The current selector allows two same-preparation attempts. Its separate third lifetime documentary attempt requires explicit recovery through a linked successor preparation. The prior TDD promise to preserve both the selector and the same preparation did not explain that boundary.

The TDD now stops same-operation automatic recovery at the existing explicit_recovery_required result. It does not create another preparation or automatically admit a third attempt. This clarifies the accepted resource boundary instead of introducing a new recovery permission.

### Context-only completion: qualified rather than accepted as a blanket defect

Current code counts nonblocked material as useful to a need and can produce a complete handoff. PRODUCT distinguishes useful controlled preparation from factual support and economic answers; completed Sources preparation does not claim each economic question is answered. Oracle identified a real ambiguity in the TDD's stronger wording, but the inspected complete/prepared values alone do not prove false economic adjudication or justify a new deterministic sufficiency gate.

The TDD now defines completion as accountable preparation with work, material, gaps and unfinished items. It preserves contextual material and legitimate contextual completion, while an explicitly unfinished outcomes investigation remains partial. It does not infer economic sufficiency from a use enum, common-context flag or natural-language question, fabricate a gap, or add another model call. Whether model-declared work and coverage are faithful remains a semantic qualification concern; that quality was not evaluated in this follow-up.

### Qualification/comparison callers: confirmed integration boundary

Their shared helper calls lack an operation request ID. A new pending-result variant cannot silently grant them an operation recovery lifecycle. The TDD now restricts that variant to validated opt-in scheduled operations; the other callers share detector/classifier corrections and keep their explicit unfinished result contract. No permanent parallel transport or duplicated retry logic is introduced.

## Remaining verification

No production implementation, backend publication, actual-data migration, live provider call or broad project suite ran. The code-derived findings and characterization probes justify these design corrections. Future corrected recovery, stale-epoch fencing, positive resume, projection conversion and no-legacy cutover still require the TDD's discriminating implementation tests and matching local runtime checks. The revised document has not been re-reviewed by Oracle or Architect; their original reports remain immutable and must not be represented as approval of this revision.

## Complexity and document checks

The five code-smell guardrail questions support these corrections: execution knowledge stays in operations/invocation lifecycle, financial knowledge in existing projection/receipt owners and documentary interpretation in Sources; distinct worker, authorization and financial lifetimes explain real failure modes rather than additional retry engines; one current examination/projection contract contains future change; the compact model receipt and existing history reference hide the new recovery/storage details; and no generic migration framework, parser or speculative extension point is introduced. The explicit historical availability state represents missing current examination without preserving its obsolete executor. Existing similarly named author/verification metadata remains separate.

`pnpm docs:check` passed with 82 Markdown files and 461 links, zero errors and the pre-existing advisory TECH word count. Because task artifacts are outside that checker's coverage, local targets, the JSON example and whitespace were checked directly for the revised TDD and this verification record. `git diff --check` passed for the revised TDD, and there are no retained changes under production code or the diagnostic test path. The frozen original review candidate retains its recorded hash.
