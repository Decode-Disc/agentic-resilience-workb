# Explore schema-enforced model output

Status: deferred exploration, 2026-11-06. No implementation decision.

Sources currently receives its completion schema in the required context, but its native request does not send a provider-level `response_format`. The harness parses and validates returned text afterward. A retained paid reply mixed prose with fenced JSON and required correction. Recovery already exists; budget exhaustion prevented the next paid attempt, so that result does not establish a recovery defect. See the qualification evidence (`docs-checkpoint-2026-11-18:docs/verification/2026-11-06-harness-targeted-regressions.md`).

Explore deriving a provider-enforced JSON Schema from the canonical completion validator through the existing native transport. This could reduce formatting failures and avoid spending correction calls on JSON syntax. Separate documentary controls already use structured output through the [one-shot transport](../../../convex/integrations/modelTransport.ts). [OpenRouter supports schema-constrained output on compatible endpoints](https://openrouter.ai/docs/guides/features/structured-outputs); a schema in the prompt alone does not enable it.

Before adopting it, verify endpoint support, the accepted strict-schema subset, and compatibility with Pi's existing tools, streaming, retained history and refusal recovery. Check the actual serialized request and incomplete/error responses. Preserve cumulative accounting and conversational Workbench text replies; no extra model loop is implied.

Schema conformance constrains format and fields. Evidence references, freshness, permissions and semantic support still require their existing domain controls.
