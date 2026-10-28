---
name: workflow-ui-reproduction
description: Convert approved HTML and canvas workflow references into faithful, reusable components and screens ready for later workflow implementation. Use when reproducing workflow interfaces, extracting their presentation layer, or correcting differences from a supplied visual reference. Covers browser comparison, preservation of existing UI, functional local interactions and reference motion. Does not implement backend workflows or authorize redesign.
---

# Workflow UI Reproduction

Produce a faithful, usable presentation foundation that can later receive workflow data and operations. Visual fidelity, reusable implementation and working local interactions are separate requirements; satisfy all three.

## When to Use

Use when converting approved workflow references into reusable components, layouts or screens, or correcting a reproduction against its source. Apply the project’s [workbench-frontend](../workbench-frontend/SKILL.md) procedure alongside this specialized workflow.

## When Not to Use

Do not use for open-ended redesign, product conception, backend implementation or a minor cosmetic correction that needs no reference-conversion workflow.

## 1. Establish the target and the preserved foundation

A reference can describe a new block without replacing the surrounding application. Establish which parts come from the reference and which retain their existing owners before making implementation choices.

Inspect the working diff, actual consumers, existing components and the exact references named by the user. Classify affected surfaces as preserve, modify, replace or remove. Explain the evidence and authorization for anything beyond preservation.

Preserve the existing shell background, composer, company picker, navigation, title hierarchy, favicon, typography and responsive behavior unless the requested change explicitly affects them. A design-system adoption does not authorize recomposing pages absent from the reference.

When a reusable owner or accepted application treatment differs from the supplied reference, inspect the difference and present the material choice for arbitration. Continue independent work while waiting. Do not silently replace an established treatment or ask again about a settled decision.

Proceed when the selected references, preserved surfaces and authorized changes are identifiable.

## 2. Render and capture the references before implementing

Reading HTML alone misses font loading, composition, overflow and motion. Capture the actual reference in a browser before writing its reproduction.

Use the available project browser and serving tools. Render the selected HTML with its real styles, tokens, fonts and assets. If the export needs a wrapper or template substitution to render, use a temporary adapter that preserves its content and appearance. Do not edit the reference to resemble the implementation.

Capture the existing application surface before changing it. Inspect reference and baseline at comparable viewport sizes and themes. Record enough provenance to reconnect each temporary capture to its source and state.

Observe geometry, typography, materials, identity, icons, controls and all visible regions. Exercise or inspect relevant selected, expanded and transitional states. Observe animation timing and behavior rather than inferring motion from a still image.

If a reference cannot render reliably, report the specific limitation and resolve it before claiming visual fidelity. Do not substitute an invented composition.

Keep inspection captures temporary by default. Do not introduce Docker, a pinned browser image, copied HTML test references, screenshot manifests or permanent pixel comparisons as part of ordinary conversion. These require a separately justified and authorized tooling task.

Recapture affected references if their source changes during implementation.

## 3. Assign components, layouts and screens to their real owners

Useful workflow foundations need coherent responsibilities so later logic can supply data without rebuilding their appearance.

Distinguish:

- shared components: reusable controls or analytical objects;
- layout: the common frame for a workflow;
- screens: the entry, framing, collection or other states displayed within that frame.

For example, START is the workflow frame; composer, confirmation and framing are screens within it. Reflect that distinction in names and the existing gallery’s navigation mechanism. Do not create application routes or a routing framework merely to preview screens.

Inspect and reuse existing owners before extracting anything. Keep Button and Badge in `components/ui`; use the existing Chip and company favicon components where their roles apply. A typographic placeholder from an export does not justify removing a working favicon.

Reuse an adequate composer or picker. Extract its pure presentation only when needed by an actual second consumer, preserving the connected consumer’s structure, interactions and guards. Do not create a redundant company-selection screen when the existing picker already serves the purpose.

Keep reusable analytical components in their existing library and workflow compositions with their workflow. Inspect `WorkbenchUiRoot` and portal styling before adopting library materials; do not spread scoped reference styles into global application defaults.

Expose content, relevant presentation state and callbacks. Keep fixtures separate from reusable components. Avoid backend calls, inferred domain decisions, speculative configuration and wrappers that merely forward another component’s API.

Proceed when each changed responsibility has one owner and an actual consumer.

## 4. Reproduce the complete visual composition

Faithful conversion depends on the relationships between regions, not only recognizable cards or colors.

Compare the implementation with the captured reference as it develops. Match the selected source’s spacing, alignment, dimensions, type scale, borders, surfaces, shadows, icons and text hierarchy while retaining the agreed application foundation.

Inspect computed font family, weight, size and line height when typography differs. Preserve the baseline on unrelated pages; changing workspace styling does not authorize changing the index page’s title or body text.

Include secondary regions that establish meaning or state: source columns, selection treatments, contextual popovers, action footers and disclosure triggers. An empty or incomplete gallery example cannot demonstrate the component’s intended appearance.

Use current runtime tokens and variants. Editable fields should remain distinguishable from outline buttons, and focus should have one coherent treatment. Preserve semantic color differences and approved refinements documented by the current design owner.

Do not render an HTML export, iframe or screenshot as the reusable component. Do not force agreement by changing the reference, clipping useful content or imposing fixed dimensions that break realistic data.

Proceed when the complete composition is recognizable at the intended sizes and accommodates realistic content.

## 5. Make local interactions work

An interface foundation should support the actions whose outcomes are already determined by its supplied data. A callback notification alone is insufficient for an action that can work locally.

Trace each visible control through its user-visible result. Implement applicable local behavior:

- quick text fills the intended composer, preserves editability and gives it focus;
- questions can be edited and added, with focus placed in the new field;
- an alternative activity can receive its own text;
- fixture search, selection, clear and removal produce coherent results and dependent panels;
- public links can be staged and removed through the existing dialog, with consistent counts;
- disclosure, selection and contextual inspection expose the appropriate content;
- navigation reaches the intended available screen and preserves the selected theme;
- overlays dismiss correctly, restore context and return keyboard focus.

Keep gallery data clearly illustrative. Reuse its existing navigation and available destinations. Do not invent a missing workflow screen or imply that local interaction has started research, saved a decision or retrieved evidence.

Identify operations that require backend logic or an unresolved product decision. Keep their unconnected status explicit rather than fabricating successful execution.

## 6. Preserve motion and complete cancellation

Motion explains a state change only when it follows the actual interaction and can be interrupted safely.

Observe reference animations and reuse their existing owners. Use [motion-react](../motion-react/SKILL.md) for the relevant interaction animations. Preserve progress sweeps, opening direction and dismissal behavior where the reference establishes them. Do not animate fictional research progress on connected application screens.

For quick-text feedback, reuse the existing fill behavior when available. Repeated selection should replay the feedback, while manual typing remains immediately usable and cannot be overwritten by a delayed animation.

Verify cancellation in the consuming screen, not only in the reusable countdown component. If “Stay here” means returning to the underlying screen, cancel automatic navigation, dismiss the obstructing handoff, restore readable content and keep a manual way to continue.

Respect reduced motion without removing controls or changing the result of an action. Check repeated activation, interruption, unmount cleanup and focus restoration where relevant.

Proceed when animations and their non-animated alternatives lead to the same usable state.

## 7. Verify both fidelity and usability in the browser

A passing test cannot establish reference fidelity, and an implementation screenshot alone cannot establish comparison.

Personally inspect the rendered reference and implementation. Compare the same relevant themes, widths and states, including desktop and mobile. Inspect the integration surface as well as the gallery when an existing application consumer changed.

Exercise the changed controls. Check keyboard access, focus, dismissal, navigation, console errors, wrapping and scrolling. Add realistic long content and extra rows; a composer or dock must not cover actions when the content grows.

Use temporary captures and executable browser observations to resolve differences. Do not stop after inspecting source code, running types or viewing only the implementation.

Report the implemented foundation, preview entry points, verified states, actual checks and remaining unconnected operations. Distinguish gallery behavior from connected workflow delivery. Do not claim protected-runtime or backend completion from fixture interactions.
