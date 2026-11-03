---
name: workbench-harness-development
description: Develop and evolve the Workbench shared agent harness, add agent definitions or business operations, and repair execution defects found during qualification. Use when changes affect execution contracts, native tools, history, effect adoption, progress, recovery or publication, so shared corrections reach every applicable agent.
---

# Workbench Harness Development

Develop agents and business operations through the existing shared execution contracts. Turn demonstrated qualification defects into corrections and regressions at the owner that should protect all applicable callers.

## When to Use

Use for a new agent definition, a new business operation, a shared execution change, or implementation of a harness correction identified by qualification.

## When Not to Use

For evaluation-only work, use [workbench-evaluation](../workbench-evaluation/SKILL.md). Frontend-only changes use the frontend workflow. This skill does not authorize live calls, deployment or a new architecture.

## 1. Locate the Contract and Its Owner

Use the [technical contract](../../../context/TECH.md) as architectural authority. Inspect the current implementation before choosing where to change it:

- [Agent catalogue](../../../convex/execution/agentCatalog.ts) and [definition contract](../../../convex/execution/agentDefinition.ts): registered versions, scopes, permitted operation references and domain completion.
- [Execution protocol](../../../convex/execution/executionProtocol.ts): operation capabilities, effects and typed outcomes.
- Existing execution modules: admission, invocation lifecycle, effect adoption, immutable journal/history, progress and publication.
- Existing domain and integration modules: business policy, evidence, provider access and domain-owned presentation.

For the requested behavior, identify the authoritative state, the enforcing module and its callers. Separate shared mechanics from domain policy and model judgment. A similar-looking operation is not automatically the same responsibility.

**Exit:** the proposed change has a named owner and an observable contract, without a parallel implementation.

## 2. Extend the Existing Mechanism

For a new agent, register its versioned schemas and definition through the static catalogues. Select its execution scope, authorized operations, context, progress deltas and completion contract. Reuse operation objects; adding an agent should not require an agent-specific branch in the execution driver.

For a new operation, choose its declared effect kind and use the existing business owner. Define canonical input, request identity, authority pin, observable outcome and adoption behavior through the operation contract. Keep domain effect, retained observation and effect adoption distinct. Progress returns verified deltas; the executor owns lifecycle and accounting.

Keep mechanical parameters at the shared boundary that can derive them from observed state. Apply business validation in its domain owner. Pi retains the native generation/tool loop and compaction; Convex retains authority, persistence, scheduling, accounting and publication.

When relocating existing operations, move their bodies mechanically and establish preservation before rewriting behavior. Respect pinned records and versions; do not introduce an implicit migration or an extra compatibility layer.

**Exit:** the real registered path uses the existing executor and owners, with no copied business rule or second retry, budget, history or publication mechanism.

## 3. Convert Qualification Failures into Shared Regressions

Trace the original request through prepared model input, raw output, operation receipt, retained observation, adopted effect and published response. Locate the first demonstrated divergence before changing code.

Choose the correction boundary:

- Shared execution defect: correct the shared owner and cover applicable registered definitions.
- Domain defect: correct the business owner and verify its authorized consumers.
- Model or summarization error: separate task failure from execution failure. A prompt change is not deterministic enforcement; disclose what a bounded guard can and cannot verify.

Use TDD through the real public boundary. Reproduce the observed failure, then test the shared invariant and its important negative case. Exercise the consuming module rather than a copied helper. If a supposed shared correction requires patches in each agent, inspect the ownership leak before proceeding.

Keep raw observations and meaningful failure states inspectable. Do not turn unknown effects into retries, rewrite failed evidence or silently replace an invalid continuation with a different read.

**Exit:** the regression catches the original failure and protects the relevant contract beyond the first agent that exposed it.

## 4. Verify Architecture and Behavior

Use the existing [registry-wide conformance suite](../../../src/__tests__/convex/execution/operation-conformance.test.ts) and [execution ownership checker](../../../scripts/check-execution-boundaries.ts). Ensure a new binding is discovered and its fixture supplies its real scope; do not copy the same checks into a per-agent suite or bypass them with an allowlist.

Select checks for the changed contract: capabilities, authorization and generation fences; idempotency and retained effects; refusal recovery; history membership and progress; native continuation and published truth. Shared rules need representative coverage across affected definitions; domain rules need their authorized domain boundary.

Start with focused regressions. After behavior stabilizes, run the affected conformance, ownership and type checks. Use the installed owner to regenerate changed model-input profiles or bindings.

**Exit:** the boundary and its negative cases pass, architectural enforcement remains active, and unverified behavior is explicit.

## 5. Close the Bounded Development Lot

Use [workbench-evaluation](../workbench-evaluation/SKILL.md) for the final authorized qualification. Preserve the fixed core cases and distinguish execution integrity, full task success and explicit partial containment.

Finish with the owning changes, regression evidence, qualification scope and remaining limits. A material failure blocks acceptance of its affected capability. Accurate stylistic imperfections do not justify an unbounded series of patches or paid batches, and independent roadmap work can continue.
