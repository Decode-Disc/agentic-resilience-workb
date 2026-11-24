---
type: design-review
repos:
  - identifier: "abdwhb-png/decoding-discontinuity-proto"
    sha: "cf757669701104f835a29fb1f0941d1c78ce3304"
date: "2026-11-19"
flow: tdd
status: revised-design-approved-runtime-unverified
---

> November 19 implementation update: this report preserves the research/design state at its original checkpoint. The implemented mechanisms, measurements and verification limits are recorded in [09-implementation-complete.md](09-implementation-complete.md); current technical obligations remain in the repository technical contract.

# Performance Review: Sources and Evaluator Technical Design

The user requested one independent `performance-reviewer` assessment before approving Program Design. The native reviewer used Codex GPT-6.1 Sol with fixed xhigh reasoning in a fresh read-only context. Its scope was the proposed design and the relevant current repository/installed-SDK paths, not implemented changes. No other review lane was requested or run.

The [exact reviewed input](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/performance-review-input.md) is preserved with SHA-256 `1a5a74997a087f34e08b51dea9c920f8de2827b4dbca71749cf15748133e38e4`. Line references to the original proposal below use that snapshot. The reviewer concluded **NEEDS OPTIMIZATION in Program Design**; the approved System Design remains sound. The author revised [the current design](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/04-tdd-sources-evaluator.md) in place. Those revisions have not received a second specialist review or runtime validation.

## HIGH: enriched structured-output snapshots amplify parsing and retained SDK state

**Reviewed location:** [original proposal, line 182](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/performance-review-input.md:182). The proposal used `streamText` with `Output.object` and captured text from `fullStream`.

**Evidence:** installed AI SDK 7.0.138 [reparses accumulated text and serializes each changed partial object](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/node_modules/ai/src/generate-text/stream-text.ts:1027); [Output.object supplies the partial parser](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/node_modules/ai/src/generate-text/output.ts:163). [fullStream tees enriched events](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/node_modules/ai/src/generate-text/stream-text.ts:3280), keeping an internal branch available. A single application consumer therefore does not imply bounded/linear SDK memory. For final visible size B across k growing deltas, logical snapshot payload and parsing work can approach O(kB). Illustratively, a 128 KiB object in 1,000 evenly sized deltas produces about 62.6 MiB of prefixes per complete traversal, before object overhead. This is a source-derived example, not a heap measurement.

The same enrichment can withhold unchanged, whitespace or malformed suffixes until text end, so a late public-stream capture can miss native deltas before interruption. This related evidence-retention observation was reported by the performance reviewer; no separate correctness review was run.

**Disposition:** corrected in the proposed code shape. Capture visible native deltas in the existing routed-model streaming middleware before enrichment. Batch text ahead of enrichment using the SDK's [pre-output transform extension](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/node_modules/ai/src/generate-text/stream-text.ts:1897), deriving capacity from existing fragment policy and preserving channel/terminal metadata. Keep SDK complete-output/schema validation, avoid unused stream projections, and do not build a JSON parser or patch the dependency. Remaining SDK buffering is explicit.

**Required evidence:** retained-response replay measuring CPU, peak heap and native/enriched event counts; regressions proving that incomplete or unchanged native suffixes reach the protected diagnostic prefix. Not yet run for this design.

## MEDIUM: append sequence cannot become one storage fragment per provider delta

**Reviewed location:** [original proposal, line 167](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/performance-review-input.md:167). Coalescing only while a mutation is busy does not batch slow arrivals. The proposal did not distinguish append identity from storage fragment layout.

**Evidence:** [immutable retained-text staging](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/retainedText.ts:78) reads and compares complete manifest arrays and [copies fragment-end metadata](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/retainedText.ts:137). [Its validation](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/retainedText.ts:66) also assumes near-capacity immutable fragments. Reusing that manifest shape for m tiny append fragments creates O(m²) cumulative metadata work; 1,000 fragments would rewrite about 30.5 MiB of hash strings alone. This is an estimate, not observed storage traffic.

**Disposition:** corrected in the proposed storage contract. Append sequence is separate from fragment index. The writer maintains bounded tail/counter/hash state, packs finalized fragments at the existing capacity, and constructs a sealed manifest once. It does not copy the full prefix or extend a growing manifest on each tiny append. The existing immutable path remains unchanged. Slow arrivals may still create many bounded writes, so measurements remain required rather than claiming that coalescing removes their cost.

**Required evidence:** replay the same content under slow and bursty delivery; record mutations, packed fragment count, header/tail bytes and capture latency. Measure cancellation drain, seal and receipt settlement together against the existing [ten-second settlement grace](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/resourcePolicy.ts:45). The revision preserves the last committed prefix and explicit incompleteness if the suffix cannot be committed within existing authority; it does not increase the deadline.

## MEDIUM, measure first: fallback wait wakes can replay the entire Pi log

**Reviewed location:** [original proposal, line 150](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/performance-review-input.md:150).

**Evidence:** [the operation wait task](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/integrations/piMission.ts:263) schedules fallback resumes every 30 seconds. [The mission opens storage first](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/integrations/piMission.ts:168), and [storage opening replays retained commits](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/integrations/piStorage.ts:195). This costs O(S × T/30s) for retained log size S and wait duration T. A roughly 590-second wait implies about twenty replays; at the permitted 32 MiB ceiling this represents roughly 640 MiB read/parsed per mission, or 3.1 GiB across five missions. Typical logs may be much smaller; no production slowdown was measured.

**Disposition:** retained as a measure-first implementation condition. The revised design names the existing `piControl.prepare` path for a fenced readiness check before hydration if actual replay measurements justify it. Skip hydration only when an owned scheduled operation remains waiting and no result, steering/input, authority transition or terminal settlement needs processing. Any uncertain readiness state takes the normal path. Preserve completion-triggered wakes, fallback interval, leases and generation tokens; do not add a parallel cache or task projection.

**Required evidence:** actual retained log sizes, replay bytes and worker startup times for representative and valid admitted-large logs. If the fast path is needed, exercise completion/steering races and generation changes. No measurement or fast path has been implemented.

## MEDIUM design gap: polling snapshots must not repeatedly carry first-input bytes

**Reviewed location:** [original proposal, line 224](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/.agents/artifacts/sources-workflow-no-legacy/performance-review-input.md:224).

**Evidence:** [qualificationSnapshot](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/fixtures.ts:1709) deliberately avoids transcript scans; [the runner polls](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/scripts/evaluations/workbench-browser/scenarios.ts:413) at approximately one-second intervals. Embedding a 128 KiB request in every snapshot would transfer roughly 150 MiB over twenty minutes per case. The original proposal did not explicitly require that behavior; its unspecified projection left the risk open. This is a hypothetical design cost, not an existing measured transfer.

**Disposition:** corrected in the proposed projection. Poll only milestone identity, dispatch state and hash. Hydrate/archive the immutable request once per bound invocation/hash through existing fragment readers; subsequent polls reuse that artifact. Keep actual request bytes outside recurring snapshots.

**Required evidence:** deterministic runner replay recording snapshot payload size, fragment reads and artifact count. Not yet run for this design.

## Reviewed areas with no additional issue identified

The reviewer found atomic scheduling, one execution claim and completion wake proportionate: constant lifecycle work without increased provider concurrency. Indexed sequential-admission checks remain appropriate. Extend the existing transactionally updated lot usage row with conflict state instead of scanning receipts during polling; use existing run/status indexes for active-operation existence checks. A one-off relay ledger fold at restart or continuation is proportionate to the observed twelve-dispatch lot. Complete replies and diagnostic prefixes add intentional linear storage for different evidence roles within existing envelopes. No new execution, accounting or observability system was recommended.

## Verification and approval boundary

The reviewer ran read-only repository, Git and installed-SDK inspection. It changed no files and ran no tests, benchmarks, services or provider calls. The author checked the cited SDK transform/tee behavior and worker entry points, then revised the design and its performance acceptance criteria. Documentation validation is recorded with the authoring turn; it does not qualify runtime performance. The original reviewer verdict is preserved. Three findings have concrete design corrections; the hydration concern retains its measurement condition. All runtime benefits remain unverified. The user approved revised Program Design on November 19 with those measurements as implementation acceptance conditions. No second specialist assessment or additional lane is implied.
