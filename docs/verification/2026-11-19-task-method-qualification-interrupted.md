# Task-method qualification interrupted by an invalid controller binding

Date: November 19, 2026. The user authorized one comparison of 24 executions, twelve per configuration, with GLM 5.3 Flash high (USD 3 per configuration, USD 6 and 400 model calls cumulative) and GPT-6.1 Sol high review (USD 10 per configuration, USD 20 and 120 requests cumulative). No correction or additional repetition was authorized. This report records an invalid, interrupted attempt; it establishes no comparison result or improvement in analytical judgment.

Follow-up, November 20, 2026: the native continuation failure has been reproduced and corrected at the shared stream adapter. The [correction report](2026-11-20-native-response-continuation.md) identifies the terminal-error race and its regression coverage. This does not change the original interrupted result or authorize a replacement comparison.

## Execution and accounting

Campaign `t971fqpwrxbzzwyfkhk9rt6rj98jhecf` used manifest hash `885e37ee97baede347fc39be2a362292b19b1e950b3dc53913b2d1b1ec92330e`. Only the retained-method control started, on the NVIDIA H20 supplied-filing case. One of 24 scenarios was attempted and interrupted; no scenario completed, eleven remaining control cases and all twelve treatment cases were unrun. No Sources mission or independent reviewer inference ran. The backend runner was used; no browser journey was exercised.

The four GLM reasoning calls succeeded and have final provider-reported charges totaling USD 0.00237242. There were no paid search/acquisition calls, reviewer attempts, pending provider receipts or unknown-charge reservations. The campaign's native reconciliation now records four model calls, zero search/acquisition calls and USD 0.00237242 (with floating-point serialization rounding). Workflow time from first scenario start to interruption was approximately 3 minutes 47 seconds; preparation and subsequent diagnosis are outside that duration.

A prior preflight attempt failed on six corpus JSON formatting checks before admitting a lot or making a model call. Formatting and descriptor file hashes were corrected; the resolved manifest and documentary bytes remained equal. The actual candidate hash was `c68b14a062af96b139f0e3763756e210b313372efdea947f2cdea1dbcd5b64a2`. The preflight failure is retained separately and is not an additional paid attempt.

## Confirmed preparation error

The executing assistant incorrectly supplied `controllerModel: "z-ai/glm-5.3-flash"` in both configuration profiles. This field enables the optional Workbench response-coherence controller; it does not select the Sources agent. `campaign-configuration.ts` consequently enabled that controller, which had previously been disabled. Workbench and Sources model assignments are already supplied separately through `models`.

`responseControlActions.ts` accepts a model from the Decisions catalogue with zero completion pricing. GLM is the generative workflow model and does not meet that contract. The operation `rd79ahnaekcp6cshefc6b1rebd8jhgsp` completed and adopted `unavailable / configuration_unavailable`, before paid controller admission. This is a confirmed error in the prepared experimental configuration, not evidence that the native skills failed. A replacement profile would omit `controllerModel` from both arms while retaining their shared workflow models and high reasoning. The original immutable mandate must not be rewritten or its failed attempt erased.

## Separate continuation uncertainty

The supplied filing was read and a research program was persisted, but the final assistant draft was not published. At interruption, the conversation turn was active and its mission remained running after the controller's unavailable outcome was adopted. That is not explained solely by invalid controller configuration: `responseControl.ts` provides an unavailable-with-reserve publication path. The native Pi path ends a slice when completion returns `pending_operations`; continuation after that operation needs separate verification.

Five existing focused response-control tests passed during closeout, including unavailable metadata/capacity. Those tests explicitly call invocation completion after dispatch; they demonstrate publication when completion is invoked, not that native Pi schedules and performs that continuation. They do not reproduce or resolve the observed stall. The next discriminating check is a deterministic reproduction through native Pi operation settlement and resumption with unavailable controller metadata, asserting that the retained draft becomes a published reply without another paid call. No production fix is justified until that boundary is localized.

## Cleanup and retained evidence

Dispatch authority and the campaign context are closed. All four invocations returned. The research run is idle; its historical mission and conversation turn still retain their unfinished statuses. Context cleanup only cancels runs marked running or paused, so closure is not evidence that those framing records became terminal.

Initial cleanup failed to restore the original Sources assignment because its enabled model's native input profiles were stale. Refreshing those existing profiles without inference allowed the existing campaign configuration owner to restore the Sources assignment, GLM reasoning preference and disabled response controller. All three owned configuration changes are marked restored. Native reconciliation then succeeded. Original cleanup and reconciliation failures remain preserved in the initial archive; the later recovery is recorded separately rather than changing that evidence into success.

The [native archive record](../../scripts/evaluations/archives/20261119T225242568Z-campaign-native-task-methods-20261119-lot-1/record.json) reports `restored_and_verified` and preserves the exact lot code snapshot, scenario inputs, observations, request/response and cost records, and initial cleanup failure. Its compressed archive is local-only, with SHA-256 `5a4ec9d5bb584b565a2c7b9dee73da39afcc63028e2b0287a51dcd29b280069c`. The [verified supplementary archive](../../scripts/evaluations/archives/20261119T225938866Z-task-method-comparison-interrupted-closeout/record.json) preserves seven closeout files, including reconciliation, restored configuration, focused test results and this report before addition of this archive link. Archiving establishes byte preservation, not semantic validity.

## Capability decision

The comparison is incomplete and invalid for judging the skills. Existing deterministic delivery and replay checks remain usable within their stated limits. Correct the experimental controller binding and isolate the native publication continuation before proposing any replacement paid comparison. A replacement would need explicit authority because the approved mandate excludes corrections and repetitions; the USD 0.00237242 already spent must remain in cumulative accounting rather than being reset. No second arm, reviewer inference, production correction or paid replacement was launched.
