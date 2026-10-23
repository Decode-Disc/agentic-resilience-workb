# Components and Ownership

Use this locator when choosing or extending frontend controls and presentation. Paths below are relative to the repository root. Inspect installed exports, props, callers, and tests; this table does not freeze their APIs or reproduce their behavior contracts.

Source review supplies the current examples. For another surface, locate its route and feature owners rather than forcing it through a source-review component.

| Responsibility | Existing owners and inspection targets |
| --- | --- |
| Analyst-facing research text | `src/lib/presentation/research-copy.ts`. Trace the generated Convex result that supplies the state, then the presentation helper and its consumers. Keep domain decisions in Convex. |
| Source categories and document metadata | `src/components/workspace/source-family-badge.tsx`, with document-kind and authority presentation in `research-copy.ts`. Compare carousel, reader, adjustment board, and candidate list before changing a shared treatment. |
| Inclusion and source decisions | `src/components/workspace/source-decision.tsx`. Inspect the caller's effective inclusion and decision inputs rather than inferring them from reading or coverage. |
| Coverage | `src/components/workspace/source-coverage-rail.tsx`. Inspect shared status appearance and text alongside the overview and inspector callers. Preserve their distinct disclosure and navigation responsibilities. |
| Source reader and visual preview | `src/components/workspace/source-context-panel.tsx` and `source-browser-view.tsx`. Compare details, selected-source changes, available/unavailable preview, and retained original-document actions. |
| Proposal groups and navigation | `src/components/workspace/source-proposal-review.tsx`, `source-master-list.tsx`, and `src/components/ui/discrete-tabs.tsx`. Inspect the route owner for durable view/filter state. |
| Disclosures and contextual help | `src/components/ui/accordion.tsx`, `collapsible.tsx`, and `responsive-popover.tsx`. Inspect their actual motion, keyboard, focus, and responsive APIs before composing them. |
| Feedback and query recovery | `src/components/ui/alert-status.tsx`, `load-error-alert.tsx`, `empty.tsx`, and `src/components/load-error-boundary.tsx`. Choose by the outcome and existing caller; an operational interruption is not merely secondary metadata. |
| Standard controls and icons | `src/components/ui/button.tsx`, `badge.tsx`, and `src/components/icon.tsx`. Verify installed icon exports and inspect the actual glyph at the intended size. |
| Tokens and responsive behavior | `src/assets/styles/themes/evidence-workbench.css`, `src/assets/styles/base-preset.css`, `src/styles.css`, and `src/hooks/use-responsive.tsx`. Use `DESIGN.md` to locate intended style ownership. |

## Reuse behavior, preserve composition

Trace the same action through its entry points: visible text, accessible name, icon, callback, state, and destination. Reuse one operation path rather than rebuilding it for the carousel, inspector, or mobile layout.

Choose disclosure by purpose. An accordion can retain topic-specific detail in context; a popover can hold a short shared explanation. They can coexist without repeating the same content. Reuse `ResponsivePopover` for the established click/tap and narrow-screen drawer behavior when it fits. Do not make necessary help hover-only or replace the accepted interaction solely to simplify implementation.

Compare card regions across short and long titles, absent dates, annotations, and selection states. Keep stable metadata rows aligned and meaningful annotations discoverable. Preserve the established preview frame and actions when showing an unavailable result. Consult `DESIGN.md` for the current accepted composition rather than inventing another arrangement here.

Before changing a shared primitive default, inspect its other consumers. Apply a local width, chevron, stacking, or density requirement in the requesting consumer unless the change belongs to the shared contract. Do not create another wrapper, status map, or palette when an existing owner can express the need.

## Inspect colors by meaning

Read the current tokens and presentation owner rather than assigning colors independently in each component. Availability, analyst approval, source family, document kind, and provenance are different concepts; adjacent badges need not share a color just because they share a shape. Preserve an established family treatment unless its removal is authorized. Inspect both themes when a treatment changes, including text contrast and selected/unselected states. Never treat a category's color as proof that its assertions are verified.
