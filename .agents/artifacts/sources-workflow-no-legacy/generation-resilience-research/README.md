# Generation Resilience Research Evidence

These machine-local artifacts characterize repository revision `6043a64af02577cb3aaf13eb2a3ce1e8804f7060` on November 21, 2026. They are research evidence, not new production acceptance rules. No paid provider request was made.

| File | Purpose |
| --- | --- |
| `observations.json` | Actual transport outcomes, exact retained-stream replay, native partial objects and chunk-timeout observations. |
| `retained-measurements.json` | Recalculated original output sizes, hashes, invocation durations and inspected timing availability. Wire hashes use Python UTF-8 canonical JSON and should only be compared within this file. |
| `transport-probe.test.ts.txt` | Ten temporary tests importing the real documentary transport and installed SDK, replacing only external HTTP. |
| `transport-and-baseline-tests.log` | Ten probes and 55 existing tests passing. |
| `eof-integration-probe.test.ts.txt` | One appended probe reusing the existing Sources integration fixture and actual dispatch/persistence. |
| `eof-integration-initial.log` | Initial fixture assertion error: receipt diagnostics are stored under `diagnostic`, not `outputDiagnostic`. |
| `eof-integration-tests.log` | Corrected probe proves a second generation and successful persisted operation after EOF without terminal evidence. |

## Reproduction

The transport probe was temporarily placed at `src/__tests__/convex/integrations/generation-resilience-research.test.ts`. It reads the retained original invocation exports at the absolute path recorded in its source and writes only this evidence directory. Run it with the existing Vitest configuration and the three suites listed in the report. Its local HTTP streams use fixture credentials and cannot make network requests through their supplied fetch functions.

The EOF integration probe was temporarily appended to `src/__tests__/convex/sources/documentary-control-integration.test.ts`, where it reuses that file's private fixture and documentary response helper. It uses the real scheduled Sources operation and Convex collaborators, with global provider HTTP replaced. Run that file with `-t 'research: EOF'`. Restore only the marked probe after the check, preserving unrelated changes. Both temporary test edits were removed after execution; no `.skip` or `.only` was added.

The 1,200 ms replay deadline and 100 ms native chunk timeout are deliberately short research-fixture settings, not recommended production values. Replaying exact retained bytes does not reproduce their historical timing. These probes characterize current behavior; a corrective regression must assert that unproven termination does not authorize a new generation.
