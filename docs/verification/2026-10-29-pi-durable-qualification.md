# Pi Durable qualification with local Convex

Date: 2026-10-29. Scope: qualify Pi Durable with a simulated provider, actual Convex persistence, interruption recovery and an inventory of potentially replaceable Workbench code. This is evidence for a decision, not approval to migrate the application or change the contracts in [TECH](../../context/TECH.md). The application remained on `main` at `8a3b1bfd9432e79c6e12b29b8962e722726c6022`, with its existing local modifications preserved.

## Verdict

Pi Durable runs inside a real local Convex Node action and can reopen persisted execution state in another process or action. Twenty final tests pass. However, Pi alone redispatches an interrupted model request whose result was not retained. The tested application admission ledger prevents that redispatch and reuses confirmed observations. Adoption would therefore retain application control over unknown outcomes, authorization, accounting and business effects. Net code reduction is not demonstrated by this qualification.

## Executed setup

The isolated project is `/tmp/workbench-pi-durable-qualification-4v0jpqla`. It uses published [`@earendil-works/pi-durable@1.4.0`](https://www.npmjs.com/package/@earendil-works/pi-durable/v/1.4.0), matching Pi AI/Chord 1.4.0, Convex 1.47.0 and Node 24.18.0. Exact registry metadata was checked before installation. Installation used `sfw pnpm add --save-exact` with the seven-day release cooldown, disabled lifecycle scripts and exotic-dependency protection. The installed package declarations and implementation, rather than a newer repository README, determined the tested API.

The qualification backend had its own database, storage and synthetic credentials on fixed ports 3440/3441. The publisher checked instance identity and successfully applied functions, generated bindings and schema with TypeScript checking enabled. Earlier rejected pushes were corrected; checks were not disabled. The application's backend, frontend, ports, dependency files and data were untouched. No paid provider or cloud deployment was used.

The fixture uses the actual Pi `Harness`, task system, `MemoryStorage` read projection and built-in faux provider. Its 111-line storage adapter persists commits atomically to Convex before adopting them locally, reconstructs the projection from paginated commits and resolves lost acknowledgements by commit identity. Convex owns sequential commit admission, IDs, writer generations, model admission/observation and a deterministic business effect. These are real modules, not copies of Pi algorithms. Internal-only functions reject unauthenticated access; this is not a qualification of Workbench visitor authorization.

## Results and failure evidence

| Scenario | Observed result |
| --- | --- |
| Model/tool round inside a Convex Node action | Completed with the retained numeric result; resubmitting the same request made zero additional model calls. |
| Worker killed after the assistant commit or tool-result commit was stored | A fresh process reused retained state; no duplicate of the confirmed model request or business effect. The later model call completing the round remained legitimate. |
| Worker killed after the business effect but before its Pi tool-result commit | The tool callback entered twice. Convex applied the effect once and reused its result on re-entry. This does not establish exactly-once callback execution or safety for an arbitrary external effect. |
| Worker killed after reply observation but before the Pi assistant commit | The application ledger supplied the confirmed reply without another provider dispatch for that request. |
| Lost acknowledgement after a stored assistant commit | Commit lookup confirmed persistence; execution continued without resending the request. |
| Worker killed after provider dispatch, before reply observation | Native Pi redispatched. With the application guard, the request remained unanswered with `attempt_outcome_unknown` and only one dispatch. |
| Sleeping task outlives its action | A Convex scheduled action reopened Pi and completed the retained task with result 22, without a model call. This tests one controlled wakeup, not a general wakeup adapter. |
| Same database reopened after backend process restart | The completed request remained available, with zero new model calls or effect dispatches. Backend shutdown was graceful; worker interruptions used `SIGKILL`. |
| Persistence failure before the first Pi commit | Zero provider calls and zero committed log entries. |
| Commit and ownership conflicts | Identical commits reused their sequence; conflicting payloads, competing sequence claims and stale writers were rejected. Takeover was explicit after stopping the old worker, not an automatic distributed lease. |

The decisive RED command was `node --experimental-strip-types --test tests/native-no-redispatch.test.ts`. Its unchanged assertion failed with `3 !== 1`: the initial interrupted dispatch was followed by a repeated request and the final response call. Both model and durable error retries were disabled; restart of the unfinished request phase is separate from those retries. Enabling the host guard made the same assertion pass, without changing Pi or weakening the test.

Additional tests executed eight tools from one response, retained and processed twenty-five steering messages during an active generation, and manually compacted context from 19,755 to 704 serialized bytes while keeping exact earlier entries retrievable from Convex. The summary was simulated: this establishes the compaction mechanism, not its semantic quality. Steering checks do not prove Workbench's instruction-version or publication rules.

## Code that could be replaced

The inventory measures physical source lines, including imports and comments, in the current dirty checkout; hashes are retained with the local evidence. Counts identify substitution candidates, not an implemented deletion or a maintenance-cost estimate.

| Existing owner | Gross candidate lines | Boundary that would need replacing |
| --- | ---: | --- |
| `convex/execution/missionWorkflow.ts`, lines 230–336 | 107 | Workflow loop body. Its calls into business admission, authority and adoption cannot simply disappear. Historical Workflow references still need support. |
| `convex/integrations/agentBackends.ts` | 103 | Current generation adapters and resolution. Pinned historical backends cannot be removed before their compatibility obligations end. |
| `convex/integrations/agentStorage.ts` | 88 | Convex Agent storage coupling. Correlation, visible-message delivery and the new Pi storage binding still need owners. |
| Total | 298 | Prospective gross replacement surface, before replacement code and compatibility support. |

The broader five-file inspection envelope, including `invokeAgentModel.ts` and `missionHistory.ts`, is 1,023 lines. It mixes replaceable mechanics with application policy, so claiming 1,023 removable lines would be unsupported. Operations, invocation admission/closure, authority, budgets, cancellation, journal, business definitions and publication rules remain application responsibilities. The shared model transport also serves qualification/comparison and cannot be deleted wholesale.

The executable prototype itself contains 881 lines across seven runtime/backend files, including fault injection, simulated provider logic, inspection and fixtures. Within that, the storage adapter is 111 lines and the Convex store/schema are 275 lines. These are not a production net-cost estimate: a migration should reuse existing application guarantees rather than copy fixture implementations. Zero application lines were deleted; no positive net line saving has yet been proven.

## Verification, artifacts and limits

From the isolated project, the following command passed 19 tests:

```sh
QUALIFICATION_GUARD=true node --experimental-strip-types --test --test-concurrency=1 tests/qualification.test.ts tests/storage.test.ts tests/conversation-capabilities.test.ts tests/action.test.ts tests/native-no-redispatch.test.ts
```

The separate `node --experimental-strip-types --test tests/backend-restart.test.ts` passed one test. Strict TypeScript checking passed, and Biome checked the 15 runtime/backend/test files without changes. These are isolated runtime tests, not the application suite or browser acceptance. No production function changed, so the application build, browser journey and watcher synchronization were not rerun.

Raw logs, registry evidence, inventory and source hashes are local-only under the qualification directory's `evidence/`. Key files are `qualification-final.log`, `backend-restart.log`, `native-no-redispatch-red.log`, `no-redispatch-guarded-green.log`, `publish.log` and `current-code-inventory.json`. The reproducible fixture is documented in `README.md` and frozen in `evidence/qualification-source.tar.gz` with `source-manifest.json`; credentials, database and dependencies are excluded. Archive SHA-256: `32386245306c9685653f764c8046472b3b49419b217f982a4b4c2e10bfcf5da8`. These temporary artifacts are not preserved by Git.

Unqualified areas include full storage conformance and large payloads, the cost of rebuilding the complete in-memory log projection, distributed ownership and wakeup recovery, application budgets/slots, pause/revocation, publication races, historical Workflow compatibility, and journal redaction with actual provider content. The unknown-outcome guard was exercised with fixed task/request identities, not every possible context or routing change. The three independent review findings were open during qualification; their subsequent application repairs are recorded in the [shared-harness verification](2026-10-27-shared-agent-harness.md). The Pi fixtures did not repair them. No automatic compaction threshold, real-provider quality or full Workbench migration is certified.

The task-owned backend was stopped after verification. Ports 3210/3211/5173 retained the original application processes, and ports 3440/3441 had no listeners. No application fixture flag was enabled. Only this verification record was added to the repository; current product and technical references were not changed because no migration decision has been made.
