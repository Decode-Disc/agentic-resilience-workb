# Qualification Campaign Commands and Manifests

Use this reference when preparing a campaign, selecting a configuration or recovering an interrupted lot. The [evaluation workflow](../SKILL.md#prepare-and-execute) owns the procedure and judgment; the [technical qualification contract](../../../../context/TECH.md#access-resources-and-security) owns campaign enforcement. These commands operate on the same absolute evidence directory outside the checkout.

## Commands

Run `pnpm workbench:qualify --help` to inspect current options. Preparation retains a reviewable mandate; authorization records the user's explicit approval of that mandate.

```sh
pnpm workbench:qualify --campaign prepare --manifest /absolute/mandate.json --output /absolute/evidence-directory
pnpm workbench:qualify --campaign authorize --output /absolute/evidence-directory
pnpm workbench:qualify --campaign run --output /absolute/evidence-directory
pnpm workbench:qualify --campaign status --output /absolute/evidence-directory
pnpm workbench:qualify --campaign assess --output /absolute/evidence-directory --review /absolute/review.json
pnpm workbench:qualify --campaign close --output /absolute/evidence-directory
```

`run --configuration ID` selects a declared profile; omission selects the next unqualified profile on the current candidate. `run --correction "description of the authorized correction"` identifies a correction within the mandate. One lot runs one configuration across the declared scenarios, then stops for the development agent's assessment. All required profiles must pass on the same candidate; a correction resets coverage without replacing historical results.

After interruption, inspect `status` before using `run` for native cleanup and reconciliation. That recovery does not repeat paid effects or open a replacement lot. Preserve rejected evidence and inspect diagnostics if assessment or cleanup fails; do not regenerate an evidence index manually to make assessment pass.

## Manifest Selection

Use version 2 for new configurable campaigns. The exported `campaignManifestSchema` in [qualificationCampaignPolicy.ts](../../../../convex/qualificationCampaignPolicy.ts) is the input contract; consult it for required fields and supported combinations rather than maintaining a parallel schema here.

- Declare `scenarios` with free identifiers, stable CIK identities, current company metadata, framing and ordered `steps`. Omit scenarios only to select the existing default battery, whose resolved content preparation freezes.
- Declare `configurations` with explicit `quality` or `harness_stress` purpose and per-role model/reasoning choices. Live models must already be prepared and available in the catalogue. Quality qualification uses the configuration owner's recommended reasoning; do not invent levels the model does not advertise.
- Declare mandatory expectations, correction paths, expiration, maximum lots, repetition allowance and per-lot/cumulative budgets. Per-lot limits are shared across scenarios; optional scenario caps can reduce them.

Version 1 remains readable with its historical limits. Version 2 uses declared budgets within the technical engine constraints. Select deterministic mode for zero-provider Workbench or Sources mechanics; those results do not establish live model quality.
