---
name: Agentic Resilience Evidence Workbench
description: An understated, modern and precise visual system for evidence-led research.
colors:
  primary: oklch(0.29 0.04 307.99)
  primary-foreground: oklch(0.985 0.002 308)
  background: oklch(0.9522 0.0022 308)
  foreground: oklch(0.1811 0.0092 308)
  card: oklch(0.9911 0.0011 308)
  card-foreground: oklch(0.1811 0.0092 308)
  popover: oklch(0.9931 0.0009 308)
  muted: oklch(0.9231 0.0033 308)
  muted-foreground: oklch(0.4842 0.0126 308)
  secondary: oklch(0.91 0 0)
  secondary-foreground: oklch(0.2568 0.0092 308)
  accent: color-mix(in oklab, var(--brand-purple) 12%, white)
  accent-foreground: oklch(0.415 0.2019 300.7)
  border: oklch(0.922 0 0)
  input: oklch(0.922 0 0)
  ring: oklch(0.415 0.2019 300.7)
  brand-purple: oklch(0.415 0.2019 300.7)
  brand-green: oklch(0.61 0.05 157.84)
  approved: oklch(0.5 0.09 186.7)
  approved-foreground: oklch(0.985 0.002 308)
  evidence-fact: oklch(0.4856 0.1016 258.76)
  evidence-inference: oklch(0.415 0.2019 300.7)
  evidence-hypothesis: oklch(0.5086 0.1022 70.64)
  evidence-unknown: oklch(0.4842 0.0126 308)
  counter-evidence: oklch(0.5725 0.2009 356.87)
  review: oklch(82.8% 0.189 84.429)
  sidebar-accent: color-mix(in oklab, var(--brand-green) 22%, white)
  sidebar-accent-foreground: oklch(0.31 0.055 190)
  destructive: oklch(0.577 0.245 27.325)
  dark-primary: oklch(0.9302 0.0084 308)
  dark-primary-foreground: oklch(0.1911 0.0071 308)
  dark-background: oklch(0.1911 0.0071 308)
  dark-foreground: oklch(0.9622 0.0042 308)
  dark-card: oklch(0.2381 0.0092 308)
  dark-card-foreground: oklch(0.9622 0.0042 308)
  dark-popover: oklch(0.2511 0.0098 308)
  dark-muted: oklch(0.2691 0.0102 308)
  dark-muted-foreground: oklch(0.7282 0.0124 308)
  dark-secondary: oklch(0.2851 0.0122 308)
  dark-secondary-foreground: oklch(0.9302 0.0084 308)
  dark-accent: color-mix(in oklab, var(--brand-purple) 20%, black)
  dark-accent-foreground: oklch(0.92 0.035 186.7)
  dark-border: oklch(1 0 0 / 10%)
  dark-input: oklch(1 0 0 / 15%)
  dark-ring: oklch(0.7024 0.146 308.49)
  dark-brand-purple: oklch(0.7024 0.146 308.49)
  dark-brand-green: oklch(88.01% 0.051 137.14)
  dark-approved: oklch(0.7285 0.0968 186.7)
  dark-approved-foreground: oklch(0.985 0.002 308)
  dark-evidence-fact: oklch(0.72 0.105 258.76)
  dark-evidence-inference: oklch(0.7024 0.146 308.49)
  dark-evidence-hypothesis: oklch(0.76 0.12 70.64)
  dark-evidence-unknown: oklch(0.7282 0.0124 308)
  dark-counter-evidence: oklch(0.73 0.16 356.87)
  dark-review: oklch(0.76 0.12 70.64)
  dark-sidebar-accent: color-mix(in oklab, var(--brand-green) 24%, black)
  dark-sidebar-accent-foreground: oklch(0.92 0.035 186.7)
  dark-destructive: oklch(0.704 0.191 22.216)
typography:
  display:
    fontFamily: '"Geist Variable", "Geist", "Segoe UI", ui-sans-serif, sans-serif'
    fontSize: 1.875rem
    fontWeight: 600
    lineHeight: 2.25rem
    letterSpacing: -0.025em
  display-sm:
    fontFamily: '"Geist Variable", "Geist", "Segoe UI", ui-sans-serif, sans-serif'
    fontSize: 2.25rem
    fontWeight: 600
    lineHeight: 2.5rem
    letterSpacing: -0.025em
  display-md:
    fontFamily: '"Geist Variable", "Geist", "Segoe UI", ui-sans-serif, sans-serif'
    fontSize: 3rem
    fontWeight: 600
    lineHeight: 1
    letterSpacing: -0.025em
  title:
    fontFamily: '"Geist Variable", "Geist", "Segoe UI", ui-sans-serif, sans-serif'
    fontSize: 1.125rem
    fontWeight: 600
    lineHeight: 1.75rem
    letterSpacing: -0.025em
  body:
    fontFamily: '"Geist Variable", "Geist", "Segoe UI", ui-sans-serif, sans-serif'
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: '"Geist Variable", "Geist", "Segoe UI", ui-sans-serif, sans-serif'
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.25rem
  label:
    fontFamily: '"SFMono-Regular", "Cascadia Code", "Roboto Mono", ui-monospace, monospace'
    fontSize: 0.6875rem
    fontWeight: 500
    lineHeight: 1.5
    letterSpacing: 0.12em
rounded:
  sm: 0.4rem
  md: 0.6rem
  lg: 1rem
  xl: 1.2rem
  2xl: 1.4rem
  3xl: 1.8rem
  4xl: 2.2rem
  badge: .75rem
  input: .65rem
  source-card: .75rem
spacing:
  half: 0.125rem
  '1': 0.25rem
  '1.5': 0.375rem
  '2': 0.5rem
  '3': 0.75rem
  '4': 1rem
  '5': 1.25rem
  '6': 1.5rem
  '7': 1.75rem
  '8': 2rem
  '11': 2.75rem
  '12': 3rem
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.primary-foreground}'
    rounded: '{rounded.md}'
    padding: 0 0.75rem
    height: 2.25rem
  button-outline:
    backgroundColor: color-mix(in oklab, var(--background) 70%, transparent)
    textColor: '{colors.foreground}'
    rounded: '{rounded.md}'
    padding: 0 0.75rem
    height: 2.25rem
  button-secondary:
    backgroundColor: '{colors.secondary}'
    textColor: '{colors.secondary-foreground}'
    rounded: '{rounded.md}'
    padding: 0 0.75rem
    height: 2.25rem
  button-ghost:
    backgroundColor: transparent
    textColor: '{colors.foreground}'
    rounded: '{rounded.md}'
    padding: 0 0.75rem
    height: 2.25rem
  button-destructive:
    backgroundColor: color-mix(in oklab, var(--destructive) 10%, transparent)
    textColor: '{colors.destructive}'
    rounded: '{rounded.md}'
    padding: 0 0.75rem
    height: 2.25rem
  button-link:
    backgroundColor: transparent
    textColor: var(--color-blue-500)
    rounded: '{rounded.md}'
    padding: 0 0.75rem
    height: 2.25rem
  button-approved:
    backgroundColor: '{colors.approved}'
    textColor: '{colors.approved-foreground}'
    rounded: '{rounded.md}'
    padding: 0 0.75rem
    height: 2.25rem
  input:
    backgroundColor: color-mix(in oklab, var(--input) 50%, transparent)
    textColor: '{colors.foreground}'
    rounded: '{rounded.3xl}'
    padding: 0.25rem 0.75rem
    height: 2.25rem
  badge-outline:
    textColor: '{colors.foreground}'
    rounded: '{rounded.lg}'
    padding: 0.125rem 0.375rem
  card:
    backgroundColor: '{colors.card}'
    textColor: '{colors.card-foreground}'
    rounded: '{rounded.4xl}'
    padding: 1.5rem 0
  glass-card:
    backgroundColor: color-mix(in oklab, var(--card) 46%, transparent)
    textColor: '{colors.card-foreground}'
    rounded: '{rounded.xl}'
  navigation-current:
    backgroundColor: '{colors.sidebar-accent}'
    textColor: '{colors.sidebar-accent-foreground}'
    rounded: '{rounded.md}'
    padding: 0.5rem 0.625rem
---

# Design System: Agentic Resilience Evidence Workbench

## Overview

**Creative North Star: "The Evidence Workbench"**

Understated, modern and precise is the intended standard. The current interface does not yet meet the required level of restraint, usability or ease of learning. This record captures its existing visual vocabulary while making that gap explicit. A near-neutral canvas, Geist reading text and compact monospaced metadata provide the foundation for clearer evidence, source references and analyst decisions.

Depth comes from readable layering, discreet structural shadows and selective glass. Controls are crisp, precise and restrained. Qatalog informs the neutral foundation and hairline separation, the Volvo EX30 concept informs frosted focal surfaces, and Decoding Discontinuity informs the existing violet and green recognition signals. The institutional research audience remains the context for these choices.

Future refinement should make the workflow calmer, easier to understand and less demanding to operate. The system should prepare and organize work proactively, resolve routine steps autonomously and request analyst attention for exceptions or material judgments. Use clear defaults, progressive disclosure and grouped review instead of repeated confirmation of every item or internal step. This direction preserves the mandatory corpus approval and final analyst authority defined in the product contract. It is an improvement objective, not a claim that the current interface already achieves it.

**Key Characteristics:**

- Near-neutral reading surfaces with selective recognition accents.
- A shared sans-serif family with compact monospaced metadata.
- Hairline separation, rounded containers and deliberate surface hierarchy.
- Evidence meaning expressed with labels as well as color.
- Responsive workspaces that preserve access to context and sources.
- Progressive simplification through proactive preparation and review by exception.

Captured from the working tree on 2026-10-20. Runtime values remain owned by the [active theme](src/assets/styles/themes/evidence-workbench.css), its [base preset](src/assets/styles/base-preset.css), the [global stylesheet](src/styles.css), and shared components. This file is a portable documentation snapshot in the [DESIGN.md format](https://raw.githubusercontent.com/google-labs-code/design.md/main/docs/spec.md). It does not replace [AGENTS.md](AGENTS.md), [technical contracts](context/TECH.md), or the [existing design-system reference](docs/design-systems/2026-07-24-evidence-workbench-design-system.md).

The frontmatter records light-theme primitives and explicit `dark-` counterparts. Runtime `.dark` overrides remain authoritative. The companion `.impeccable/design.json` contains extension metadata and isolated static component previews, not production implementations. Its synthesized tonal strips are palette illustrations, not additional application tokens.

Rendered evidence was sampled from the existing local application at desktop and narrow-mobile sizes: the landing page, public Start surface, and explicitly illustrative workspace and source-review prototypes. Protected dossier behavior is documented from source rather than accepted as a verified journey. Controlled dark-class samples verify the CSS variant, not a user-facing theme-switch interaction.

## Colors

The palette combines near-neutral surfaces and institutional ink with deliberate violet and green signals. Component and semantic exceptions remain identified rather than expanded into brand colors.

### Primary

- **Institutional Ink** (`primary`): ordinary primary actions. The dark variant reverses the emphasis to a pale neutral for contrast against dark surfaces.
- **Ink Contrast** (`primary-foreground`): text on ordinary primary actions.

### Secondary

- **Research Violet** (`brand-purple`): recognition accents, focus, selection and small metadata moments. It is not the primary action color.
- **Violet Wash** (`accent`): a source-defined mix for interactive emphasis. Preserve the CSS mix rather than freezing a visually sampled approximation.

### Tertiary

- **Quiet Sage** (`brand-green`): the restrained green brand signal and source for selected neutral tints. Its dark counterpart is intentionally lighter.
- **Approval Teal** (`approved`): positive analyst approval. Keep it distinct from the brand-green primitive.

### Neutral

- **Research Canvas** (`background`), **Reading Ink** (`foreground`), **Paper Surface** (`card`), and **Floating Paper** (`popover`): the main reading layers, with dark counterparts for each.
- **Quiet Surface** (`muted`), **Secondary Surface** (`secondary`), and **Secondary Ink** (`muted-foreground`): supporting controls and secondary text.
- **Hairline** (`border`) and **Field Fill** (`input`): low-contrast structure and field surfaces. Alpha-valued dark tokens remain alpha-valued.

### Evidence and feedback

`evidence-fact`, `evidence-inference`, `evidence-hypothesis`, `evidence-unknown`, `counter-evidence`, and `review` describe analytical meaning. Blue, violet, amber, neutral and rose roles are not a decorative category palette. `destructive` is inherited from the base preset for destructive feedback, not a new brand accent.

The library also contains blue link styling and named-color badge variants. The landing implementation uses an indigo badge and a local violet spotlight. These are observed component or consumer treatments, not permission to add another shared palette. The current source-specific badges can use declared family colors while keeping evidence classification separate.

**The Semantic Color Rule.** Use violet for recognition and focus, green for its existing brand and approval roles, and evidence colors only when they convey analytical meaning. A color never replaces its label.

## Typography

**Display and body:** Geist Variable, with the existing Geist, Segoe UI and system sans-serif fallbacks. **Metadata:** the existing SFMono-Regular, Cascadia Code, Roboto Mono and system monospace stack. Geist is imported by the active theme; the Inter declaration in the earlier base preset is not the effective application font.

### Hierarchy

- **Display:** the shared responsive display utility progresses from `display` through `display-sm` to `display-md`; it uses semibold weight and tight tracking.
- **Title:** the shared section treatment uses the `title` role. Standard card titles use their component's medium-weight treatment rather than inheriting a display style.
- **Body:** `body` is the default reading scale. `body-sm` supports compact cards, descriptions and source details.
- **Label:** `label` is the compact monospaced uppercase metadata treatment. Use ordinary sentence case for reading text and controls unless the established consumer requires otherwise.

The landing headline is a distinct consumer: medium weight, tight negative tracking, near-solid line spacing and responsive sizing up to a sampled 70.4px desktop size. It is not the default workspace heading. The composer likewise owns its textarea sizing; neither consumer changes the shared type scale.

**The Shared Type Rule.** Use the active Geist stacks for headings and body copy. Reserve the shared monospaced metadata treatment for short labels and identifiers rather than ordinary paragraphs.

## Layout

The application uses fluid containers and a shared maximum width of 100rem. The shared outer gutter grows from 1rem to 1.5rem at `sm`, then to 3rem at `md`. Spacing derives from Tailwind's quarter-rem unit, with half steps where the existing components need them. The frontmatter records the reused steps rather than inventing a separate density system.

Default framework breakpoints remain `sm`, `md`, `lg`, `xl` and `2xl`; the sidecar records their exact dimensions. The shared display utility changes at `sm` and `md`. The landing header becomes a compact menu below `lg`, and its content remains narrower than the application container.

The production dossier rail is sticky beneath the shell header. Its source owns desktop expanded and collapsed widths of 14rem and 4.25rem, and mobile widths of 11.5rem and 3.25rem. Below `md`, the collapsed rail reserves its narrow width and expansion overlays content. Desktop context is retractable; smaller screens use a drawer. Explicit collapse choices persist while mobile selection collapses the rail without overwriting that preference. These are existing interface contracts, not newly inferred behavior from the illustrative prototype.

Source review preserves its summary, source groups, adjustment board and candidate inspection modes. Below `md`, the production summary toolbar uses its labelled actions popover while primary approval and direct source moves remain available. The standalone prototype has its own illustrative arrangement and is not evidence that every production breakpoint was exercised.

## Elevation & Depth

Readable layering, discreet structural shadows and selective glass establish depth. Near-neutral fills and hairline borders separate ordinary regions. Frosted floating layers add translucency, an inset highlight and a fine inner rim. The evidence surface remains the focal working area rather than becoming a decorative glass showcase.

### Shadow Vocabulary

- **Soft surface** (`--surface-shadow-soft`): the named panel shadow, including its inset highlight. Used by the shared opaque-panel utility and selected content groups.
- **Floating surface** (`--surface-shadow-floating`): the named elevated shadow with inner rim. Used by the floating-surface utility and landing header.

The sidecar retains exact light and dark shadow strings from the theme. Existing `Card` uses the framework medium shadow and a fine ring, `GridCard` uses its small shadow, and `LiquidGlassCard` owns separate glow and inset-edge intensity maps. The production rail also applies an extra-large framework shadow. These are existing implementation differences from the two-tier shared guidance, not additional global design tiers. This documentation pass does not alter them.

**The Surface Hierarchy Rule.** Use the two named theme shadows for shared panel and floating-surface guidance. Preserve existing component-specific depth during documentation or refinement rather than treating every observed shadow as another global tier.

## Shapes

The theme's base radius is 1rem. The frontmatter contains the resolved small-through-extra-large scale, plus the existing badge, field-group and source-card aliases. Rounded buttons, broader container corners, pill navigation and the source cards' clipped or tabbed upper edges form the incumbent silhouette.

Do not flatten every component to one corner size. Ordinary buttons use the medium radius, standard fields use the larger rounded treatment, and standard cards use the broadest theme corner. Glass cards accept a configurable radius. Consumers may override these deliberately, as the landing matrix preview does.

Borders are usually single-pixel hairlines using semantic border values with opacity. Standard cards instead combine their rounded silhouette with a fine foreground ring. The landing grid, concentric orbits, textured backdrop and metallic call-to-action remain consumer-specific expressions.

## Components

### Buttons

Crisp, precise and restrained. The [shared button](src/components/ui/button.tsx) exposes default, outline, secondary, ghost, destructive and link variants. The frontmatter calls the source's default variant `button-primary` to describe its visual role. The separate shared approval utility supplies the established teal action treatment.

The default size is 36px high, with 24px, 32px and 44px alternatives and separate icon sizes. Primary hover reduces the fill opacity. Outline uses the existing translucent fill, with a transparent dark default. Secondary changes its tonal mix on hover. Ghost relies on a muted hover surface. Destructive is a semantic tint. Link preserves the library's existing blue styling.

Focus uses the semantic ring and a three-pixel halo. Pressing a regular non-popup button shifts it down one pixel. Disabled controls remove pointer interaction and halve opacity. Invalid states use the inherited destructive token. Consumer adjustments, including uppercase approval copy, do not become default button behavior.

### Chips and badges

Compact classifications and secondary metadata. The [shared badge](src/components/ui/badge.tsx) offers default, regular, secondary, destructive, outline and fancy variants, plus optional family-color and dot treatments. Evidence surfaces may override these with domain-semantic colors or use neutral outlines. Keep labels explicit and preserve the distinction between a badge and an action.

### Cards and containers

The [standard card](src/components/ui/card.tsx) has a broad radius, a fine ring, vertical spacing and inset content regions. Default spacing is 24px; its compact size uses 16px. It is not interchangeable with the opaque panel utility.

[LiquidGlassCard](src/components/ui/liquid-glass.tsx) is a translucent, configurable focal surface with a filtered backdrop, separate glow and inset-edge layers, and optional drag or expansion. Its default hover and press scales are opt-out; production navigation suppresses those scales. Its timing uses the organic curve recorded in the sidecar.

[GridCard](src/components/ui/grid-card.tsx) adds a restrained, masked decorative grid over a translucent card. Its tone is configurable. Keep its decoration separate from analytical meaning. The sidecar's card entry shows these three surface families together; the glass and grid examples are static CSS representations, not an SVG-filter, motion or shader reproduction.

### Inputs and fields

Quiet, rounded and legible. The [standard input](src/components/ui/input.tsx) uses a half-opacity semantic field fill, a transparent default border and the broad rounded treatment. Focus adds the semantic ring; invalid and disabled states match the shared control vocabulary. At narrow widths it retains the larger base font before the desktop compact text treatment applies.

The research composer is a distinct framed multiline control with its own toolbar, company selector, reference affordance and geometry. Its textarea is not a restyled copy of the standard single-line input. Preserve that composition when connecting behavior.

### Navigation

The production [workspace rail](src/components/workspace/workspace-navigation-rail.tsx) keeps six sections visible, marks the current section with a tinted surface and side indicator, and explains locked prerequisites. Collapsed items retain labels through accessible naming and tooltips. The sidecar preview illustrates its visual states without reproducing routing, persistence or lifecycle rules.

The landing uses a separate floating pill header, dropdown context and mobile sheet. These are distinct consumers of the same surface and control vocabulary, not alternate defaults for the workspace rail.

### Motion and state

Use motion to clarify causality, selection and already-persisted progress. The organic curve is shared by the landing and glass component, while the existing motion utility has its own preset easings and the rail uses a spring indicator. The sidecar records those differences instead of claiming one global motion token exists.

Reduced-motion behavior exists in the shared motion utility and production rail, and several landing and glass layers suppress transforms through CSS. The metallic landing action and animated noise retain their own continuous effects; complete reduced-motion conformance is not established by this pass. Preserve labelled loading, empty, error, review and insufficient-evidence states rather than disguising them as animation.

## Do's and Don'ts

### Do:

- Do keep runtime values in the active theme and shared component owners. Regenerate these documentation snapshots when those owners change.
- Do use semantic colors and readable labels for claim classifications, review and approval.
- Do preserve existing responsive geometry, source controls, focus states and loading silhouettes during refinement.
- Do keep the evidence surface visually central and use glass for selective layers.
- Do verify both themes and narrow layouts when changing shared styles.
- Do reduce routine decisions and repeated review through proactive preparation, clear defaults and grouped exception review while preserving mandatory evidence checkpoints.

### Don't:

- Don't turn brand violet into the default primary action color or use evidence colors as decoration.
- Don't promote a landing-specific spotlight, grid, orbit, shader or texture into a universal workspace requirement.
- Don't create a parallel palette, radius scale or component implementation from these previews.
- Don't remove useful controls or recompose an existing surface under the name of integration or refinement.
- Don't claim contrast compliance, protected-workflow acceptance or complete reduced-motion coverage from this documentation pass.
- Don't make the analyst manage internal workflow steps or validate every item when the system can safely prepare, organize or resolve the work.
