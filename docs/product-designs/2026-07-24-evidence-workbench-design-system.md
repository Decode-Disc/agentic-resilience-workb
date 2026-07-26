# Evidence Workbench Design System

**Status:** active; refined for the selected navigation-rail workspace on 2026-07-27
**Theme:** `src/assets/styles/themes/evidence-workbench.css`  
**Tailwind entrypoint:** `src/styles.css`

## Convention

The project follows the same readable shadcn and Tailwind v4 pattern used in the
Treasury application:

```text
semantic CSS variables
    ↓
Tailwind theme aliases
    ↓
shared shadcn components and CVA variants
    ↓
Tailwind utilities in page composition
```

`base-preset.css` remains unchanged. It provides the standard shadcn Tailwind
bridge. The active theme is imported after it and changes the semantic values
globally; no wrapper class is required.

## Where styles belong

- Put palette, radius, type, shadow, and domain-state values in
  `evidence-workbench.css`.
- Put a reusable visual variant on the relevant shadcn component with CVA.
- Compose page layout with Tailwind utilities in the component.
- Add an `@utility` only when the same meaningful pattern is shared by several
  components and cannot be expressed by an existing primitive.
- Do not create page-specific BEM stylesheets or a parallel token vocabulary.

The shared utilities are intentionally limited to:

- `surface-panel` for a standard opaque panel;
- `surface-floating` for elevated navigation and overlays;
- `text-display` for restrained display headings;
- `text-section` for section headings;
- `text-micro` for compact uppercase metadata.

## Token vocabulary

Use the standard shadcn utilities for ordinary interface styling:

```tsx
<section className="bg-card text-card-foreground border-border" />
<Button variant="outline">Review evidence</Button>
```

Use the domain utilities only when the value carries evidence meaning:

```tsx
<span className="text-evidence-fact">Fact</span>
<span className="text-evidence-inference">Inference</span>
<span className="text-evidence-hypothesis">Hypothesis</span>
<span className="text-counter-evidence">Counter-evidence</span>
```

The available domain tokens are:

- `evidence-fact`
- `evidence-inference`
- `evidence-hypothesis`
- `evidence-unknown`
- `counter-evidence`
- `review`

Every analytical state still requires a text label or icon. Color never carries
the classification by itself.

## Visual direction

The system combines:

- Qatalog's institutional near-neutral canvas, hairline borders, and generous
  negative space;
- the Volvo EX30 concept's frosted surfaces, inset top highlight, inner rim, and
  soft diffuse depth, used only for floating or focal layers;
- Geist typography, compact information hierarchy, and restrained metadata;
- controlled purple and green recognition signals derived from Decoding
  Discontinuity.

The primary color is institutional ink, not purple. Purple is a small
recognition accent for focus, micro-labels, selection, navigation-trigger state,
and the quiet landing bloom. Green is the approved/positive signal and may tint
neutral accent surfaces. Evidence classification and counter-evidence colors
are reserved for their domain meaning.

The selected research workspace uses a persistent navigation rail. Apply
`surface-floating` or `LiquidGlassCard` to the rail and contextual layer, while
the evidence matrix remains the visual and analytical center. On desktop the
context panel is retractable; on smaller screens it becomes a drawer.

## Guardrails

- Prefer `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`,
  `border-border`, and component variants over raw color values.
- Keep raw color values inside the theme file.
- Extend shared shadcn primitives instead of restyling standard controls on one
  page.
- Use motion only to clarify a user action or persisted state.
- Animate progressive map or brief contributions only after their persisted
  workflow event exists.
- Keep evidence, provenance, uncertainty, and analyst control more prominent
  than decoration.
