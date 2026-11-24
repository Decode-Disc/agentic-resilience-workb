# Generated response storage — 2026-11-24

## Scope and product outcome

Baseline: `09b1fff5` on `sources-workflow-no-legacy`. The correction removes the aggregate 64 KiB rejection of generated responses while preserving authorized execution, exact retained content and one logical analyst-facing reply. The authoritative contract is [TECH](../../context/TECH.md#shared-execution-structure); [AGENTS](../../AGENTS.md#resource-policy-and-adaptive-execution) distinguishes storage/page sizes from generation authority. This report describes local code and deterministic verification, not a deployment or semantic qualification.

Invocation responses and mission results use the existing verified retained-text fragments above an inline storage threshold. Received and adopted responses share immutable bytes and retain conflict detection. Execution, recovery, response correction, administrator inspection and fixture reporting resolve those references through their existing owners. Conversation storage keeps Convex Agent as its owner, splitting long text into component records and reconstructing it as one application delivery. Existing single-record references remain readable. Dossier purge removes owned response/result fragments and fragmented invocation payloads.

## Boundary inventory

| Boundary | Result |
| --- | --- |
| Model reply decoding, retention and adoption | Removed the aggregate 64 KiB refusal. Full response validation, authority, receipt correlation and idempotency remain enforced. |
| Final conversation publication | Removed the 64 KiB refusal; exact logical text is reconstructed from component records. |
| Replaceable preview | A Unicode-safe prefix, including an initial BOM when present, is bounded by `CONVERSATION_PREVIEW_MAX_BYTES`. Exhaustion changes only the preview; it cannot abort generation. |
| Inline invocation/result storage | `RETAINED_TEXT_INLINE_BYTES` selects inline versus fragmented representation. Crossing it does not reject content. |
| Sources admission | Removed the estimated response-size refusal, including the guessed per-need explanation allowance. Actual preparation/result document capacity checks remain. |
| Tool results and history pages | Existing 64 KiB per-result/page contracts and continuations remain, including the corresponding native success-wrapper allowance. They are separate from aggregate generated responses. |
| Analyst input, working notes, one-shot input and buffered external responses | Separate existing contracts remain unchanged; this correction does not reclassify their bounds as platform requirements. Native SSE still has no cumulative wire-byte cutoff. |

Convex documents remain limited to 1 MiB; transaction and function-argument limits also remain applicable. Fragmentation does not mean infinite capacity. See [Convex limits](https://docs.convex.dev/production/state/limits). No substitute aggregate response ceiling was introduced.

## Verification

The new integration tests execute real Convex functions, schema, component storage and internal collaborators. Only provider HTTP is simulated. The large-response fixture enables Convex transaction limits. Responses of 65,537 and 1,100,001 UTF-8 bytes are retained, reconstructed, published exactly once and recovered through the publication-state query; invocation and mission documents remain below 1 MiB. Tests also cover conflicting replay, stale instructions, stale preview writers, corrupted fragments and fragment cleanup. The native Workbench path verifies the published text, one provider call, its cost receipt and no additional call or receipt after a stale wake.

Observed RED evidence before the relevant fixes: both response sizes and the large preview failed with `response_capacity`; large correction drafts failed with `invocation_unavailable`; Sources admission failed with `sources_response_capacity`; purge left retained fragments; and the preview decoder lost an initial BOM. Each consuming-boundary regression passed after correction. Temporarily restoring the original decoder cutoff made the native publication regression fail again; the production file was restored before final checks.

The former rollback test now uses a conflicting retained observation rather than requiring the retired size refusal. It still checks that receipt, invocation and budget changes roll back together, then that retry and replay settle exactly once. Existing malformed-tool tests now require canonical refusal and eventual work-budget exhaustion for both short and large malformed arguments. The Sources capacity fixture exercises all 140 authorized unavailable controls rather than stopping early at the removed response estimate; its timeout reflects the larger executed workload.

The principal regression run passed 247 tests across 17 suites, covering large responses, model accounting, conversation/history, Pi recovery and transport, response control, journal access, operation conformance, Sources capacity/completion and dossier purge. Typechecking, focused Biome lint, execution ownership, import boundaries, resource-policy generation/checks, documentation checks and the production build passed. Documentation retains its existing advisory TECH word-count warning. The build also reports client chunks above its 500 kB advisory threshold; no bundle-size improvement is claimed. Follow-up verification covered the six Pi mission tests and reran all seven large-response tests after the final Unicode preview correction. No model-input profile changed.

Reproduction commands for the observed failures and focused final verification:

```sh
pnpm exec vitest run src/__tests__/convex/execution/large-response.test.ts
pnpm exec vitest run src/__tests__/convex/execution/response-control.test.ts -t 'closed status conflict'
pnpm exec vitest run src/__tests__/convex/sources/sources-instruction-capacity.test.ts -t 'unavailable controls and later requests'
pnpm exec vitest run src/__tests__/convex/execution/large-response.test.ts -t 'purging a dossier'
pnpm exec vitest run src/__tests__/convex/execution/large-response.test.ts -t 'oversized preview'
pnpm exec vitest run src/__tests__/convex/execution/large-response.test.ts -t 'native Workbench publishes'
```

The last command is the decoder falsification probe when the retired cutoff is temporarily restored. All temporary production mutations were restored. Final regression command:

```sh
pnpm exec vitest run src/__tests__/convex/execution/{large-response,model-action,conversation,conversation-history,conversation-capacity,pi-recovery,pi-native-transport,response-control,pi-response-control,journal,history-read-cost,operation-conformance}.test.ts src/__tests__/convex/sources/{sources-completion,sources-instruction-capacity,sources-handoff-capacity}.test.ts src/__tests__/convex/admin/invocation-journal.test.ts src/__tests__/convex/access/dossier-purge.test.ts --maxWorkers=2
```

## Verification boundary

The local runtime status reports no managed processes and free Convex/site/web ports. No backend was started or published, and no real provider call, paid qualification, existing-record migration, commit or push was performed. Transaction-limit fixtures and serialized-size assertions establish deterministic storage behavior; they do not measure production latency or model task quality. Deployment/runtime verification remains pending under the existing activation conditions.
