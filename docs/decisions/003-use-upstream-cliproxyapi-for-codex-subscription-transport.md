# ADR-003: Use Upstream CLIProxyAPI for Codex Subscription Transport

> **Historical record.** Preserve the observations and limitations below. Its status, requirements and permissions describe that checkpoint, not current authority. Use the [current document owners](../../AGENTS.md#document-authority-and-required-reading) and [delivery roadmap](../ROADMAP.md); no historical budget or execution permission is renewed.

## Status

Accepted

## Date

2026-07-20

## Context

The prototype requires a provider option that can use an OpenAI Codex subscription without presenting an API-key integration as equivalent subscription access. The application must remain provider-agnostic, and OpenAI must not become the default or authoritative provider.

Implementing and maintaining the complete Codex authentication, token persistence, refresh, concurrency, and protocol behavior directly in this repository would consume disproportionate prototype time. A local CLIProxyAPI fork exists as a useful behavioral reference, but copying that fork would also copy local changes and create an unclear maintenance lineage.

The upstream project selected for the prototype is [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI). It is a third-party compatibility project, not an OpenAI-endorsed integration.

## Decision

Use the upstream CLIProxyAPI distribution as the prototype's experimental Codex subscription transport.

CLIProxyAPI is an infrastructure adapter behind the application's provider boundary. It is not the application-level model router and must not decide business capabilities, research depth, cost policy, or fallback strategy. The application-owned `ModelRouter` remains responsible for resolving capability requests across Codex subscription access, OpenRouter, and future providers.

The deployment must:

- use an upstream release or image pinned to an immutable version or digest;
- use the local fork only as a behavioral reference, never as copied source or the deployment artifact;
- expose only the inference surface required by the application;
- keep management endpoints and subscription credentials private;
- start with one instance and one Codex account unless measured load requires otherwise;
- authenticate application-to-proxy traffic with a private service credential;
- record upstream version, resolved model, usage when available, latency, status, and retry metadata;
- keep provider- and model-specific details out of domain records and workflow business logic.

This accepted decision is intentionally scoped to the candidature prototype. It favors demonstration speed and does not establish CLIProxyAPI as permanent production architecture or official OpenAI integration. A production-readiness or commercial-use review becomes relevant only if the prototype evolves into a real product; it is not an implementation gate for the candidature demo.

## Alternatives Considered

### Implement the Codex subscription provider directly

- Pros: smallest runtime surface and complete control over behavior.
- Cons: authentication and compatibility work would distract from validating the evidence-workbench thesis.
- Rejected for the prototype: may be reconsidered if the product survives validation and the supported integration surface is clear.

### Deploy the existing local fork

- Pros: already demonstrates the desired operational behavior.
- Cons: mixes local modifications with upstream behavior and creates avoidable ownership and upgrade risk.
- Rejected: the fork may inform configuration and operational tests, but it must not be copied as the application dependency.

### Use a smaller community Codex-only proxy

- Pros: potentially smaller image and configuration surface.
- Cons: the reviewed candidates did not provide equally verified authentication persistence, refresh, concurrent request handling, and maintenance signals.
- Rejected for now: reconsider only with measured evidence against the required behavior.

### Substitute an OpenAI API-key adapter

- Pros: officially documented API billing and simpler deployment.
- Cons: does not satisfy the Codex subscription option and changes the economic requirement.
- Rejected as a substitute; API-key providers may still exist as separate adapters.

## Consequences

- The prototype gains a faster path to Codex subscription access without coupling workflow code to CLIProxyAPI.
- CLIProxyAPI adds a long-running container, credential storage, version pinning, health checks, and an additional network boundary.
- Codex subscription usage has no reliable per-call dollar conversion; the prototype records available usage metadata without inventing a dollar amount.
- Failure or exhaustion of Codex capacity may trigger an application-controlled OpenRouter fallback when the configured prototype guards permit it.
- If the candidature prototype later becomes a real product, a separate decision must revisit provider terms, credential handling, availability, scaling, and support status.
