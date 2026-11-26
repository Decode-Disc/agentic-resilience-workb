# Capacity correction evidence

Date: 2026-11-25. Starting revision: `f4af3901a9946b849d052b0317f188ce998ef970`. These are retained outputs from local checks, not deployment-wide acceptance. The maintained interpretation is in `docs/verification/2026-11-25-pr2-capacity-corrections.md` at the repository root.

`fix-history-red.txt`, `invalid-operation-red.txt`, `valid-large-red.txt`, `notes-red.txt`, `scroll-fix.txt`, and `context-closed-red.txt` preserve observed failures before the corresponding corrections. `scroll-fix.txt` records the insufficient first attempt (disabling only native initialization), which still lost the reader position. The final implementation also coordinates growth-following with restoration.

`final-focused.txt` records 34 passing capacity and research-screen tests. `ui-final.txt` records 36 passing browser cases. `e2e-isolated.txt` records the completed zero-provider saved-material journey; `e2e-native.txt` also contains failed earlier attempts and must not be read as an all-green run. `platform-capacity-final.txt` records six passing large-argument cases and the deliberately tight aggregate read-budget failure; `history-platform-final2.txt` records the successful platform-sized history rerun, retaining the tighter 128 KiB budget on both list queries.

`source-fingerprints.json` identifies the tested production boundaries and large-response regression file. Logs omit browser traces and reusable admission material. They are historical evidence; reproduction commands and remaining limits belong in the verification report.

`blank-red.txt` records the unbounded blank-text path before correction. `capacity-last.txt` records all 24 capacity regressions passing after correction, and `blank-platform.txt` records both blank-text transports passing above 16 MiB. `aggregate-before-final-blank-correction.txt` is intentionally retained as a failed aggregate: 345 files passed, two new blank-text assertions ran before their fix, and the existing web restart process test timed out. It is not an all-green result. `types-last-guard.txt` and `build-last-guard.txt` record the separately successful final typecheck/build.

Command output is retained verbatim, including trailing whitespace emitted by the tools; source whitespace checks exclude these immutable text captures.
