# ADR-011: Restrict Manual Source Intake to Public HTTPS URLs

> **Historical record.** Preserve the observations and limitations below. Its status, requirements and permissions describe that checkpoint, not current authority. Use the [current document owners](../../AGENTS.md#document-authority-and-required-reading) and [delivery roadmap](../ROADMAP.md); no historical budget or execution permission is renewed.

## Status

Accepted

## Date

2026-07-27

## Context

The baseline product design and ADR-004 allow analysts to add URLs and upload
PDF files. File upload introduces storage, malware, decompression, file-type,
privacy-classification, and hosted-parser controls before the candidature
prototype has demonstrated a need for private or local documents.

The selected MVP is intentionally limited to public evidence for US-listed
technology companies. Public PDF documents remain discoverable and retrievable
when they have a canonical HTTPS URL; this decision concerns analyst-supplied
local files.

## Decision

For the MVP, analysts may add public `https://` URLs only.

An analyst-added URL is a proposed source, never direct evidence. Before it can
enter a corpus revision, the server must:

- parse and canonicalize the URL;
- reject credentials, fragments used as authority, unsupported ports, and
  non-HTTPS schemes;
- resolve DNS and reject loopback, link-local, private, reserved, and metadata
  network destinations;
- revalidate every redirect target under the same rules;
- bound redirects, response size, content type, decompression, and time;
- record retrieval metadata without treating snippets or page content as
  evidence before corpus approval.

The source then follows the same pending, accepted, rejected, retrieval,
normalization, provenance, and revision rules as discovered sources.

Local file and PDF upload is removed from the MVP. A public PDF reachable by an
approved HTTPS URL may still be normalized after approval.

This decision supersedes only the manual PDF-upload portions of ADR-004. The
SEC, Exa, Unstructured, approval, retrieval, and provenance boundaries in
ADR-004 remain accepted.

## Alternatives Considered

### Keep URL and PDF upload in the MVP

- Pros: analysts can add documents unavailable at stable public URLs.
- Cons: materially larger security and storage surface with limited value for
  the public-evidence showcase.
- Rejected for the MVP.

### Allow pasted text

- Pros: fastest manual addition.
- Cons: weak source identity and reproducible provenance; easy to detach a claim
  from its original context.
- Rejected.

### Remove manual source addition

- Pros: smallest acquisition surface.
- Cons: prevents analysts from correcting discovery omissions and resolving the
  evidence-sufficiency checkpoint.
- Rejected: bounded HTTPS URL entry preserves useful human control.

## Consequences

- Existing attachment and file-drop UI remains prototype-only and must not be
  wired to production ingestion.
- Product design, technical context, roadmap, and ADR-004 references must state
  the narrower URL-only contract.
- Upload-specific schema, storage, parsing, and security work is deferred.
- Reintroducing local files requires a new explicit decision covering privacy,
  storage, malware handling, size limits, and local versus hosted processing.
