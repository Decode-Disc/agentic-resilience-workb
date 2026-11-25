# Local storage migration verification

The local deployment `local-aboul_panga-dd_proto` was migrated from the existing November 25 backup using PR 2's additive handlers at `7ea7634e125701c00369f58b2b6f4ba83f9a6b93` and the conversation migration admission correction described below. This record establishes local data preservation and bounded public history reads. Component retirement, remaining whole-body API retirement, final runtime capacity measurements and final CI are still pending.

## Backup and migration

The original export is 179,396,336 bytes with SHA-256 `997170d405b4d704ffc82736b7a1346afef022a42b3fd9a1c9fdd808770bb01c`. Its checksum was recomputed and matched. The original stopped-backend raw backup is also retained, at 1,619,221,490 bytes. Both were preserved by hard link before this migration; no restore or database reset was performed. Private scripts, inventories and checkpoint evidence are retained in the operator's local runtime directory and are not published with this report.

All 99 legacy conversation scopes were copied, verified, reconciled and reopened: 288 original deliveries and 96 completed mission rows were reconciled. The database now contains 108 conversations and 313 deliveries; none is frozen and no legacy delivery lacks its retained body reference. All 31 original active-turn documents, conversation pointers and queue counts matched the backup after migration. Provider-call count remained 833; no provider generation was requested by this work.

An active turn previously blocked migration even when it had no possible writer. Migration now requires a global publication hold, matching conversation/run/mission/turn ownership, a Pi Durable backend, no active writer and no live session lease. It preserves logical turn and mission status. Eighteen registered Convex tests passed, covering blocked and running quiescent turns, a later queued request, active lease/writer refusal, foreign correlation, frozen writer admission and exact body restoration. The blanket active-turn refusal and four missing ownership checks were reproduced before correction. The corrected handlers were published successfully by the existing local watcher at 18:27 on November 25.

## Integrity and public reads

Independent Node and native WebCrypto checks matched 49,540 original records across invocation, execution-event, provider-call, source, capture, search-passage, proposal/rebuild/item, task-result and review-item tables. The six largest tables used 187 independently hashed creation-time blocks rather than a single aggregate transaction. These checks establish preservation, not reduced query cost. The initial execution-event comparison preceded a subsequent backfill of 413 derived context-history hashes; that backfill does not establish whole-row byte equality afterward and did not replace original observation text.

Both authenticated public history APIs were exercised on two existing research conversations. Forty-six unique original messages were reconstructed through the body reader with exact offsets, lengths and SHA-256 hashes matching the component source. Conversation history returned 44 and 2 messages; Workbench history returned 42 and 2 because it omits two approval receipts. The saved expected hashes permit repeating these reads after component removal without using a legacy reader.

The component inventory independently matched the backup: 522 threads, 2,119 messages and a largest stored message document of 28,458 JSON bytes. Related embedding, file, memory and stream tables were empty. There are 107 threads with current application references and 415 without one. The latter retain known visitor identities and historical producer patterns, but no reason for the former application parents' absence is asserted. No component rows have been deleted at this checkpoint.

## Execution limits and next acceptance boundary

One migration step timed out while concurrent verification was running. It resumed through the existing checkpoint and completed without raising resource limits; the underlying local platform timeout was not established. An earlier administrative verification script supplied an incomplete identity and was corrected to the installed CLI's subject, issuer and token-identifier shape; application authorization was unchanged. The maintenance hold was released after migration and public-read checks; no active worker or live nonterminal grant was observed at release.

Local reconciliation does not establish post-retirement functionality, peak action-memory safety, full retained Sources context cost, semantic research quality or deployment-wide acceptance elsewhere. The next acceptance boundary is the approved removal of verified obsolete copies and executable compatibility code, followed by component-absent history, native recovery, approvals, Sources wording and resource checks on the final implementation.
