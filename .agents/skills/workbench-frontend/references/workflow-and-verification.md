# Workflow and Verification

Use this reference when a frontend change touches async work, recovery, navigation, selection, approval, or the evidence needed to declare the result working. [AGENTS.md](../../../../AGENTS.md) owns the testing, local-backend, provider, and authorization rules; select checks under that contract rather than repeating its full workflow here.

## Reconstruct the affected transition

An action can appear correct while its feedback belongs to another selection or its result disappears on return. Establish the real transition so the analyst sees the outcome of the action they took. When async work, navigation, or a checkpoint changes, follow its state from the caller through persistence and back to presentation.

Trace the actual route, Convex hooks, operation, persisted result, and presentation. For the affected action, identify its prerequisite, pending state, terminal outcomes, available recovery, and consequences for existing decisions. Inspect what happens after selection changes, navigation, refresh, and reconnect when those behaviors are relevant.

Source review is wired through `src/components/workspace/live-source-review.tsx` and its query-owning subtrees. Find the generated function references in the caller rather than guessing an endpoint. The same visible action in an illustrative prototype may use local state; that does not establish protected persistence or subscription behavior.

Keep status scopes visible during inspection: a dossier-wide search limit can affect multiple topics, while results belong to the requested topic. Confirm that pending and terminal feedback stays with the correct action, and that obsolete results cannot replace the current selection or message. Inspect the shared recovery projection before creating local loading or error state.

For pre-approval work, inspect both the information available before the decision and the handoff afterward. A visible approval button does not prove the analyst has the material needed to exercise it. Conversely, documentary uncertainty must not become an invented approval blocker. Consult the authoritative contracts when changing either behavior.

## Match checks to the observable change

Excessive style assertions slow iteration, while a screenshot alone cannot prove a saved decision. Choose evidence that can expose the changed failure, because verification is useful only for the claim it actually tests. Classify the observable change before selecting the checks below.

| Change | Smallest useful evidence |
| --- | --- |
| Spacing, colors, alignment, icon placement, or wording without changed meaning | Inspect the affected real surface and states in the browser; compare with the pre-change baseline. Use existing checks as appropriate. |
| Changed status meaning, validation, selection, navigation, async transition, or custom keyboard/focus behavior | Start with a failing test importing the real module at the relevant public boundary. Then inspect the affected rendered states. |
| Convex persistence, authorization, or workflow transition | Use the repository's focused Convex tests; prove updated local-backend behavior when runtime verification is required. |
| Subscription, durable return path, or protected checkpoint | Exercise the real admitted local path, including refresh/reconnect as relevant. Component fixtures do not establish these properties. |

Select existing tests under `src/__tests__/` and browser scenarios under `e2e/`. React integration tests use the shared reference-routed Convex hook harness. Do not freeze incidental classes, dimensions, SVG paths, or library behavior merely to manufacture a RED step. A concrete harmful overflow or inaccessible action can justify a focused regression; assert the user-visible failure.

For new or recomposed views, inspect desktop and narrow mobile with realistic content; 320, 390, 1024, and 1440 pixels are useful starting samples, not a substitute for checking the actual breakpoint boundaries affected. For a small correction, inspect its affected widths and states. Record viewport height when diagnosing scroll ownership.

Exercise relevant tabs, disclosures, search, clear, navigation, and recovery. Inspect keyboard/focus, touch operation, loading geometry, empty/error outcomes, long text, and console errors. Check reduced motion when animations change and both themes when colors or surfaces change. Measure the actual scrolling element when investigating overflow; a screenshot of the top of a list does not establish correct scrolling.

## Keep evidence levels distinct

Controlled examples can establish correctness without establishing live availability or analytical usefulness. Keep the observed evidence level explicit so the handoff does not promise more than the checks demonstrate. Use the distinctions below when selecting a check and reporting its result.

- **Mockup:** establishes intended composition, not execution or persistence.
- **Deterministic fixture or component test:** establishes the exercised contract with controlled inputs, not provider availability or fresh research quality.
- **Protected local browser journey:** establishes the observed admitted path and state transitions; record whether its data is illustrative or freshly prepared.
- **Authorized live preparation:** can establish the outcome for that run. It does not establish general quality across companies or dossier types.

Use existing sessions and services. Do not start providers, searches, preparation, paid evaluations, or backend synchronization merely to improve the evidence level of a frontend task. Respect the specific authorization needed for each operation. When access or data is missing, report the exact unverified claim instead of substituting a public page.

Finish with checks scoped to the stabilized change: formatting once, focused diagnostics and tests, and the required documentation checks for documentation edits. A skill-only edit needs skill/reference validation, not an application build or a replay of the research journey. Report commands actually run and preserve failed or incomplete checks. Broaden validation only for new evidence, a repository requirement, or transversal risk.
