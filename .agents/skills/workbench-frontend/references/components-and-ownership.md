# Components and Ownership

Repeated controls drift when their behavior or presentation is rebuilt in individual consumers. Use this locator to find an existing owner before choosing or extending frontend controls, keeping shared behavior consistent without forcing unrelated layouts together. Paths below are relative to the repository root. Inspect installed exports, props, callers, and tests; this table does not freeze their APIs or reproduce their behavior contracts.

The table locates existing Sources and shared UI code. These examples do not define the composition or checkpoints of target framing, appraisal review or synthesis. For those surfaces, locate the applicable requirements in the current document, inspect actual routes, projections and components, and identify missing capabilities explicitly. Reuse readers and primitives where they fit without forcing the new responsibility through a source-review component.

| Responsibility | Existing owners and inspection targets |
| --- | --- |
| Reusable question-led presentation | `src/components/workbench-ui/index.ts` exposes the library. Inspect the relevant component's props, implementation and caller before choosing it; a presentation callback does not supply a domain operation. |
| Existing conversation presentation | `src/components/chat/` and `src/components/workspace/start/start-screens.tsx`. Trace the externally supplied transcript, assistant-ui runtime, pending-action/composer dock and screen consumers before changing their composition. |
| Library style and theme scope | `src/components/workbench-ui/glass-panel.tsx`, `root.tsx`, `src/assets/styles/workbench-ui/index.css`, component-owned CSS Modules using Tailwind `@apply`, and the active theme; [DESIGN.md](../../../../DESIGN.md#components) defines styling ownership. Inspect the existing surface component before recreating its material in consumer CSS; keep consumer geometry local. Inspect `WorkbenchUiRoot` and portal consumers together; scope reference materials to the intended subtree. |
| Shared evidence-use appearance | `src/components/workbench-ui/evidence-use.module.css`, consumed by `evidence-matrix.tsx` and `evidence-use-popover.tsx`. Compare shared state treatment with each consumer's local geometry; neither consumer's private stylesheet is the shared API. |
| Trigger-to-dialog transition | `src/components/ui/linear-modal.tsx` and the library's `inventory-sheet.tsx`. Inspect trigger, portal, focus, dismissal and reduced-motion behavior before composing the shared modal. |
| Illustrative gallery and interaction checks | `src/development/workbench-ui/`, `workbench-ui.playwright.config.ts` and `src/__tests__/design-system/workbench-ui/`. Use current design references and temporary browser captures for visual review; gallery fixtures do not establish application persistence. |
| Analyst-facing research text | `src/lib/presentation/research-copy.ts`. Trace the generated Convex result that supplies the state, then the presentation helper and its consumers. Keep domain decisions in Convex. |
| Sources section and its labels | `src/components/workspace/sources/connected-sources.tsx` owns queries, URL location and follow-ups; `src/lib/presentation/sources.tsx` owns documentary labels, reading, selection wording and matrix filters; `convex/sourcesWorkspace.ts` owns the projection. Change a label or status in the mapping, not in a screen. |
| Disclosures and contextual help | `src/components/ui/accordion.tsx`, `collapsible.tsx`, and `responsive-popover.tsx`. Inspect their actual motion, keyboard, focus, and responsive APIs before composing them. |
| Feedback and query recovery | `src/components/ui/alert-status.tsx`, `load-error-alert.tsx`, `empty.tsx`, and `src/components/load-error-boundary.tsx`. Choose by the outcome and existing caller; an operational interruption is not merely secondary metadata. |
| Standard controls and icons | `src/components/ui/button.tsx`, `src/components/ui/button.module.css`, `badge.tsx`, and `src/components/icon.tsx`. Verify installed icon exports and inspect the actual glyph at the intended size. |
| Tokens and responsive behavior | `src/assets/styles/themes/evidence-workbench.css`, `src/assets/styles/base-preset.css`, `src/styles.css`, and `src/hooks/use-responsive.tsx`. |

The local design-tool export supplies reference material, not runtime imports or a parallel maintained palette. Button and Badge remain owned by `src/components/ui`; extend their existing variants rather than adding library copies. Inspect the library's material scope before applying it to an installed screen so scoped reference treatments do not become global defaults.

## Maintain style ownership

For question-led library and START/Sources styling, use [DESIGN.md's allocation](../../../../DESIGN.md#components). The inspection below finds reusable runtime treatments before translating reference CSS; it does not define another styling contract.

1. Map reference parts to existing component/Module pairs. Inspect the shared style index and evidence-use Module for the required material or analytical treatment before declaring consumer copies. Compare purpose and state behavior before sharing coincidentally equal dimensions.
2. For card/row controls, inspect `Button`'s `unstyled` composition mode and the consumer's actual root element. For ordinary actions, compare the installed fixed-fill and compact recipes before retaining local resets. Check inherited gaps, font/border shorthands and caller overrides before removing declarations.
3. When editing `buttonVariants`, compare raw recipe consumers outside `WorkbenchUiRoot` separately from rendered Button: the helper and component have different class-merging contracts.
4. For CSS-loading changes, inspect injected stylesheet and layer order: a Module can predeclare a named layer before the Tailwind entry, and `@reference` does not establish that entry's order. Compare geometry and computed defaults even when PNG bytes match.

## Reuse behavior, preserve composition

Reusing a primitive does not by itself preserve the interaction or accepted layout. Aim for one operation flow with context-appropriate composition, because the same analyst action should retain its meaning across entry points. Inspect equivalent actions together, and distinguish a shared-contract change from a consumer's local requirement before editing.

Library components and installed workspace surfaces can serve different responsibilities despite similar names. Check their callers and data contracts before substitution. Reuse an applicable library component within the authorized surface; preserve the existing composer, company picker, header and shell owners unless their replacement is explicitly authorized. Surface adoption alone does not authorize rearranging company identity or removing its favicon.

Trace the same action through its entry points: visible text, accessible name, icon, callback, state, and destination. Reuse one operation path rather than rebuilding it for the carousel, inspector, or mobile layout.

Choose disclosure by purpose. An accordion can retain topic-specific detail in context; a popover can hold a short shared explanation. They can coexist without repeating the same content. Reuse `ResponsivePopover` for the established click/tap and narrow-screen drawer behavior when it fits. Do not make necessary help hover-only or replace the accepted interaction solely to simplify implementation.

Compare card regions across short and long titles, absent dates, annotations, and selection states. Keep stable metadata rows aligned and meaningful annotations discoverable. Preserve the established preview frame and actions when showing an unavailable result.

Registry adoption can change more than the requested component. Inspect the item source, registry dependencies and available preview or dry-run output for global CSS, theme variables, fonts, dependency additions and shared files it would create or overwrite.

For assistant-ui, resolve registry items through the configured style-aware URL so `base-luma` selects Base UI composition. Compare individual primitives with the complete Thread composition: its default reasoning, tool, attachment and action sections are not automatically product requirements. Trace message conversion and callbacks without introducing another authoritative transcript or enabling automatic client-side domain operations. Keep response-generation state separate from research progress and pause. Removing the Uai registry does not migrate its installed components or authorize replacing their screens.

Review the installed primitive's defaults alongside the consumer's explicit props and CSS overrides: colors, surfaces, typography, dimensions, overflow, scrolling, focus, motion, icons and overlay placement. Preserve the defaults unless an approved consumer requirement or a reproduced problem justifies an exception. Keep the reason local to that exception. Let the shared disclosure owner handle reduced motion; a mock, administration screen or test does not by itself justify disabling animation. When adapting a registry candidate, reconcile its defaults with the installed primitives, runtime tokens and approved composition.

Adopt only the parts needed by the interaction. Keep surface-specific styling in the owning component or consumer; preserve customized shared controls and theme definitions. Change a shared default only for an established shared requirement, after inspecting its other consumers. Review the resulting diff and rendered consumer for effects outside the requested component.

## Inspect colors by meaning

Similar-looking positive states can imply different kinds of authority. Make visual meaning agree with the underlying state so available evidence or a generated interpretation does not look like a retained human judgment. When colors, badges, or categories change, compare the established treatments across affected surfaces before selecting a token.

Read the current tokens and presentation owner rather than assigning colors independently in each component. Availability, analytical support and human adoption have distinct meanings; source family, document kind and provenance add separate information on source views. Adjacent badges need not share a color just because they share a shape. Preserve an established family treatment unless its removal is authorized. Inspect both themes when a treatment changes, including text contrast and selected/unselected states. Never treat a category's color as proof that its assertions are verified.

Where an existing owner uses utility classes or a small variant map, resolve them from literal source text; this is not a reason to replace Module-owned state selectors with JSX utility maps. Tailwind emits utilities only for class names that appear verbatim in scanned source, so such a map must store complete class names (for example `bg-warning text-warning-foreground ring-warning/25`) rather than composing them at runtime (for example `bg-${role}`) — interpolated names never reach the stylesheet and the element renders without the treatment. Before retuning a token, compute its pairing contracts with the same oklch values in both themes (fill/ink, standalone text on canvas and card) instead of judging a swatch by eye, and confirm with the browser's computed styles when the treatment changes.
