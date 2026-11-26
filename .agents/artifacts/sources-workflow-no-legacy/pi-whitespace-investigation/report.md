# Pi and AI SDK whitespace investigation

Date: 2026-11-26. Checkout: `ecb2a357fa1035577f4efb2b140436b00e66bad7`. Scope: installed-source inspection and offline replay only. No production, schema, configuration, dependency, service or provider inference changes. Installed versions verified from package manifests: Pi AI and Pi Durable 1.4.0; AI SDK 7.0.138; OpenRouter AI SDK provider 3.1.0.

## Conclusion

Pi does not remove or stop whitespace degeneration in the inspected OpenRouter generation path. With identical synthetic SSE deltas, Pi and the OpenRouter AI SDK adapter preserve the same content and tool-argument bytes, including the exact historical 1,141,943-character output and its 1,131,782 trailing whitespace characters. Pi has a stronger missing-finish check and different final tool-argument parsing; these are termination and validation differences, not a cure for upstream whitespace generation.

The independently supplied OpenRouter-origin Arize snapshot already contains the whitespace before application SDK decoding. Its decoded completion is 538,226 characters, with 535,392 trailing whitespace characters and SHA-256 `6ca9f48d0c79de520ffbf390a686cadad207aa2f7004d963a4ed388349c8ca0a`. I recalculated these values from `upstream-arize-first-control.json`; provenance verification and first-page comparison were performed by the parent investigator. Its upstream raw request has `response_format.type=json_schema`, `json_schema.strict=true`, and `provider.require_parameters=true`. This rules out local SDK whitespace fabrication for that trace; it does not identify whether the model, decoder, serving endpoint or OpenRouter forwarding first introduced the degeneration.

## Actual flow and ownership

Sources agent generation uses Pi Durable through `convex/integrations/piMission.ts:1136`, with a registered native tool loop. Its documentary examination is a separate one-shot call: `convex/integrations/documentaryControl.ts:78` calls `invokeOneShot`; `convex/integrations/modelTransport.ts:921` uses AI SDK `streamText` and `Output.object` with a Zod schema. Switching the Sources agent to Pi therefore does not remove its current AI SDK documentary examination.

Pi native model profiles select the same OpenRouter OpenAI-compatible transport (`convex/integrations/piModelProfiles.ts:48`). The application injects its admitted fetch, signal, output capacity, request policy and journaling at `piMission.ts:1136`. `convex/integrations/modelInput.ts:216` merges shared routing preferences without adding response-format mode. `convex/integrations/modelRouting.ts:178` owns routing, price constraints, reasoning preferences, temperature and zero SDK retry. Pi Durable's application settings explicitly disable automatic generation retries (`piMission.ts:1681`). Pi storage persists/fences commits and fragments large commits (`piStorage.ts:106`); it does not inspect generated whitespace.

## Installed implementation evidence

| Boundary | Verified behavior | Source |
| --- | --- | --- |
| Pi text | Concatenates every nonempty content delta verbatim; emits the same delta. | `node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js:429` |
| Pi tool arguments | Concatenates argument deltas into a raw scratch buffer; partial JSON parser produces provisional objects. No repeated-whitespace check. | Same file, lines 441–464 |
| Pi final tool parsing | Complete parse replaces the partial parse. Invalid final arguments become `{}` plus `argumentsError` containing the raw input; scratch buffers are removed. | Same file, lines 246–270; `dist/utils/json-parse.js:91` |
| Pi JSON repair | Repairs raw control characters inside strings and invalid escapes. Does not synthesize a missing JSON value or closing object at final parsing. Partial parsing is deliberately more permissive. | `dist/utils/json-parse.js:28`, `:70`, `:115` |
| Pi finish / EOF | OpenRouter compatibility requires a finish reason. EOF without it becomes `stopReason=error`, message `Stream ended without finish_reason`. Abort becomes `aborted`. | `openai-completions.js:475`, `:487`, `:504`, `:1275` |
| Pi request retries | HTTP request retry wrapper encloses initial stream acquisition, not stream-body consumption. Default max retries is zero. No automatic in-flight regeneration on whitespace. | `openai-completions.js:197`; `dist/utils/provider-retry.js:84` |
| Durable generation | Processes tool rounds after completed `toolUse`; success/length answers and error/compaction/retry branches occur after the generation returns. Automatic error retry depends on configured policy and retryable error classification. | `node_modules/@earendil-works/pi-durable/dist/harness/generation.js:397`, `:422` |
| Durable tool validation | Tool preparation and schema validation can reject invalid arguments; this happens after generation, not as a whitespace streaming guard. | `dist/harness/tool.js:165`, `:176` |
| OpenRouter AI SDK adapter text | Emits raw content as text deltas. No trimming or whitespace manufacture. | `node_modules/@openrouter/ai-sdk-provider/dist/index.js:4777` |
| Adapter tool arguments | Appends raw arguments; may publish once parsable. At terminal flush, incomplete arguments are substituted with `{}`. AI SDK schema validation must still reject invalid tool input. | Same file, lines 4905–4922 and 4962–4990 |
| Adapter EOF | Starts with finish reason `other`; tool-call presence can infer `tool-calls` even without an explicit upstream finish. | Same file, lines 4583, 4959–4966 |
| AI SDK structured output | Final JSON parse and schema validation; partial parser accepts repaired partial projections, with changed-value publication. No whitespace early-stop. | `node_modules/ai/src/generate-text/output.ts:128`, `:163`; `stream-text.ts:1027` |

The application additionally captures original Pi tool arguments independently and validates original JSON (`convex/integrations/piToolArguments.ts:13`, `:95`). It propagates the original parse failure (`piMission.ts:1287`) and, when original validation is enabled, submits unrepaired invalid bytes to canonical refusal rather than trusting Pi's repaired object (`piMission.ts:1400`). Native repair is therefore not a bypass of the application evidence contract.

AI SDK structured-output publication may buffer unchanged partial projections. In the cancellation fixture, the raw adapter received all 8,198 characters but `streamText.fullStream` exposed only the six-character JSON prefix before abort. This is explained by `stream-text.ts:1027–1053`: whitespace outside strings leaves the partial object unchanged, so text stays buffered until a later publication/end. The application's raw visible writer runs in model middleware before that structured-output transform (`modelTransport.ts:486`); its own 61,440-character packing transform is further downstream (`modelTransport.ts:935`). Neither downstream partial-output silence nor final object shape alone measures upstream progress.

## Offline differential replay

Run from this checkout:

```sh
node .agents/artifacts/sources-workflow-no-legacy/pi-whitespace-investigation/probe.mjs
```

Final run exited 0 in approximately 1.5 seconds, with 42 replay records: seven fixtures × two channels (`delta.content`, `delta.tool_calls[].function.arguments`) × Pi low-level stream, AI SDK `streamText`, and raw OpenRouter AI SDK adapter. Every request uses an injected fake fetch; global fetch throws `NETWORK_FORBIDDEN` with no real-fetch fallback. Each replay asserts exactly one HTTP request, expected request mode/tool declaration, and exact input/output hash equality (except structured-output publication after intentional cancellation, whose upstream raw adapter equality is separately checked). There were no stderr messages. No tests of whole Convex/Pi Durable mission persistence were run in this lane.

`results.json` records fixture definitions, byte hashes/lengths, raw outgoing request bodies, event types and outcomes. `probe-output.jsonl` is the concise per-case output. Input fixture definitions are literal in `probe.mjs`; the historical fixture reads the original retained export at its recorded absolute path. Synthetic fixtures use 8,192 spaces followed by 4,096 LF/TAB pairs where specified. Chunk boundaries, terminal finish events and the 40 ms cancellation are fixture mechanics, not reconstructed historical timing or proposed production policy.

| Fixture | Pi | AI SDK + OpenRouter |
| --- | --- | --- |
| Valid `{"ok":true}` | Text stop; tool use with parsed object. | Text object succeeds; tool parsed and valid. |
| Complete JSON + 16,384 whitespace chars + explicit finish | All chars retained; tool object parsed at end. | All chars retained; output object succeeds. |
| `{"ok":` + 16,384 whitespace chars + explicit finish | Text remains unvalidated text; tool has final `argumentsError`. | Final text output fails JSON parse. Tool adapter substitutes `{}`, then Zod flags invalid tool input. |
| Complete JSON + EOF / `[DONE]` without finish | Error despite valid JSON content. | Text finish `other`; SDK object parses. Tool finish inferred `tool-calls`. Application one-shot separately requires accepted finish semantics. |
| Prefix + 8,192 spaces + EOF | Error, original text retained. | Text `other` and parse failure; tool inferred completion but invalid `{}` input. |
| Prefix + 8,192 spaces then cancellation | Aborted after retaining bytes. | Raw adapter retains bytes; streamText promises reject AbortError. No regeneration. |
| Exact historical invocation 9 bytes + synthetic explicit finish | Text preserves full body; tool reports invalid JSON. | Text preserves full body and fails JSON; tool becomes invalid input. |

Historical replay input/output SHA-256 is `7798c7096b96cbe5028cb34ff916dfc219290bf39712c56d6a76484957d7b4fa`, length 1,141,943, trailing whitespace 1,131,782. Synthetic complete-with-whitespace SHA-256 is `5369c3e97ada0699ff59719291788f4ac0fad015b84362506c35427211a36671`, length 16,395. Synthetic incomplete-prefix-with-whitespace SHA-256 is `faa6a1ca3773540bedc818b1ee119a29a900f16dbc893cefe1b4b87aff5dba34`, length 16,390. All three engines match each noncancelled input within its channel.

Two probe setup errors were corrected and preserved. The first Pi low-level invocation passed legacy `Context.tools` without `normalizeContext`, so the mocked response still parsed but no tools were declared in the outgoing request; `initial-unnormalized-context-probe.mjs` and its results preserve that invalid request-shape attempt. The final probe normalizes transcript context and asserts the tool declaration. The initial AI SDK schema used `jsonSchema` without a runtime validator; missing required keys therefore could not establish schema rejection. `initial-schema-without-runtime-validator-results.json` preserves it. The final probe uses real Zod validation and observes `AI_InvalidToolInputError` for the adapter's substituted `{}`. These are research setup corrections, not product failures or RED tests.

## What a switch to Pi would change

The observed AI SDK object request sends `response_format: {type: json_schema, json_schema: {strict: true, ...}}`, with output in `delta.content`. Pi's normal tool protocol sends `tools[].function.parameters` and receives `delta.tool_calls[].function.arguments`; the probe Pi request contains no `response_format`, and no `strict: true` function parameter. Pi text-only mode contains neither output schema nor tool declaration. The serializers also differ in fields such as `max_completion_tokens` versus `max_tokens` and usage streaming options; the application merges shared route constraints afterward. These captured request bodies establish a protocol change, not a controlled live comparison of model behavior.

Moving the examiner to a Pi native tool would change the provider-facing schema mechanism, completion contract, termination handling, and durable integration. It might affect generation behavior, but no live same-input/mode-only experiment establishes improvement. The offline tests demonstrate that Pi will consume the same pathological output if the endpoint emits it, whether text or arguments. Tools cannot validate or repair a generation that is still emitting whitespace; tool execution and final validation occur after generation terminates.

## Remaining cause uncertainty and next observation

Verified: the first recent control's excessive whitespace exists in an OpenRouter-origin trace, and both installed decoders preserve identical replay bytes. Unknown: the upstream mechanism producing it; whether this is model behavior, structured decoding, endpoint translation or forwarding; whether native tools materially change incidence; per-chunk timing and the exact server-side stopping conditions. Provider cancellation and final charges for the historical calls are separately confirmed in the retained provider records. The supplied trace contains an incomplete generated response from a cancelled request; the Arize read used no string-truncation option. It is not evidence of a complete valid reply or a recording of individual wire frames. A provider `length` finish reason alone would not identify which server-side stopping condition fired.

The cheapest next discriminator is provider-side evidence for an already retained failed generation: endpoint/decoder logs or support confirmation linking the received strict schema, token sequence and actual termination condition. A claim that native tools prevent degeneration would require a separately authorized mode comparison with the same model, input and endpoint, differing only in response-format versus tool protocol; even a successful pair would not establish general reliability. No production detector, cutoff, new retry policy or repair is selected by this report.

No broad test suite, typecheck, build, browser check, backend publication or real-provider qualification was run or implied. Documentation review: this report is evidence, introduces no normative contract, duplicates no owning reference, and leaves current references unchanged.

## Parent verification

The parent reran `node .agents/artifacts/sources-workflow-no-legacy/pi-whitespace-investigation/probe.mjs`, observed exit 0, and independently checked all 42 records, exact hashes for every applicable replay, Pi's EOF error and cancellation outcomes, and empty stderr. The cancellation fixture deliberately distinguishes raw received bytes from AI SDK partial-output publication. `parent-replay-output.jsonl` and `parent-replay-stderr.txt` retain this run. These are differential replay observations, not 42 independent provider trials.

The parent queried Arize for the actual November 25 incident. The OpenRouter-origin root span for `gen-1795648705-jcNljddeE4QK95VyxLdM` carries the same first 61,440 characters as the application's retained first page, with 535,392 trailing JSON whitespace characters in its 538,226-character completion. Trace metadata identifies `source=openrouter`; endpoint attempt spans report client disconnect. The second generation's attempt and generation spans were present, but its full completion root was not returned in the inspected window. No absence of whitespace is inferred for that second call.

The HTTP wrapper records `JSON.parse(init.body)` immediately before actual dispatch (`convex/integrations/modelTransport.ts`, `createBoundedProvider`). The retained request is consequently the serialized HTTP body, not merely a prompt-building intermediate. The provider-facing Arize `rawRequest` independently retains `response_format.type=json_schema`, `strict=true`, a required boolean `coherence`, and `require_parameters=true`.

Official documentation inspected on November 26: [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs) describes endpoint-dependent strict enforcement, and [Wafer Chat Completions](https://docs.wafer.ai/serverless/chat-completions) documents JSON-schema requests, content/tool-argument channels and the possibility of repetition termination with finish reason `length`. These document the supported interface, not the decoder actually used for either historical request. The connected OpenRouter logs application required OAuth reconnection; accessible Arize records and already-retained provider receipts supplied the evidence above without changing authentication or launching inference.
