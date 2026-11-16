/** Authored application resource policy. No environment or deployment dependencies.
 * Counts, byte capacities and elapsed-time policies are distinct. Runtime callers
 * combine these defaults with immutable grants and actual provider capabilities;
 * changing a default never renews or enlarges an existing grant.
 */

/** Newly admitted work pins this contract; absent or unknown pins grant no dispatch authority. */
export const RESOURCE_POLICY_VERSION = "authority_native_v1";

/** Resolve immutable dispatch authority, never a guessed per-generation completion allowance. */
export function resolveGenerationAuthority(
    authority: { resourcePolicy?: string; deadlineAt?: number } | undefined,
    now: number,
    executionDeadlineAt?: number,
) {
    if (authority?.resourcePolicy !== RESOURCE_POLICY_VERSION)
        return {
            kind: "blocked" as const,
            code: "resource_policy_unsupported",
        };
    const deadlineAt = authority.deadlineAt;
    if (
        typeof deadlineAt !== "number" ||
        !Number.isSafeInteger(deadlineAt) ||
        deadlineAt <= now
    )
        return { kind: "blocked" as const, code: "execution_deadline" };
    if (
        executionDeadlineAt !== undefined &&
        (!Number.isSafeInteger(executionDeadlineAt) ||
            executionDeadlineAt <= now)
    )
        return { kind: "blocked" as const, code: "node_action_deadline" };
    const effectiveDeadlineAt = Math.min(
        deadlineAt,
        executionDeadlineAt ?? Infinity,
    );
    return {
        kind: "ready" as const,
        deadlineAt: effectiveDeadlineAt,
        timeoutMs: effectiveDeadlineAt - now,
    };
}

/** Receipt fencing may outlive dispatch authority; this grace never permits I/O or adoption. */
export const MODEL_SETTLEMENT_GRACE_MS = 10_000;
/** Standard Convex Node action limit. Self-hosted overrides require verified deployment evidence.
 * Source: convex-backend d26741f4bfc42bf175f409e9bf1cba6a8e052c29, crates/common/src/knobs.rs NODE_ACTION_USER_TIMEOUT_SECS.
 */
export const CONVEX_NODE_ACTION_TIMEOUT_MS = 600_000;
/** Capture once at action entry, before preparation. Leave the existing receipt-settlement grace for controlled interruption. */
export function nodeActionGenerationDeadline(startedAt: number) {
    return (
        startedAt + CONVEX_NODE_ACTION_TIMEOUT_MS - MODEL_SETTLEMENT_GRACE_MS
    );
}
/** Public controller catalogue retrieval only, never model generation completion. */
export const RESPONSE_CONTROL_METADATA_TIMEOUT_MS = 30_000;
/** Existing non-generative embedding receipt fence; expiry cannot authorize replay. */
export const SOURCE_EMBEDDING_PROVIDER_LEASE_MS = 70_000;

// Admission and bounded collection views. Exhaustion is handled by their domain owner.
export const MAX_ANALYSES_PER_VISITOR = 3;
export const BROWSER_QUALIFICATION_MAX_REQUESTS = 20;
export const BROWSER_QUALIFICATION_MAX_COST_USD = 0.5;
/** Historical aggregate Sources receipt envelope, including technical I/O. */
export const MAX_SOURCES_QUALIFICATION_RECEIPTS = 128;
export const DEFAULT_COMPANY_SEARCH_RESULT_LIMIT = 40;
export const MAX_INITIAL_SOURCE_CANDIDATES = 48;
const MAX_PREPARED_RECOMMENDATIONS = 24;
const MAX_CONFIGURED_COLLECTION_LIMIT = 200;
export const DEFAULT_PREPARATION_MAX_CONCURRENCY = 2;

// Transport/persistence capacities are bytes, not model-context tokens.
export const MAX_OPERATION_RESULT_BYTES = 64 * 1024;
const DEFAULT_PREVIEW_CACHE_TTL_MS = 60 * 60 * 1000;
const MIN_PREVIEW_CACHE_TTL_MS = 1000;
/** Larger screenshots remain returnable but are not retained in the preview cache. */
export const PREVIEW_CACHE_MAX_BYTES = 700 * 1024;
/** Preview render/HTTP/egress capacities. Exhaustion returns a typed preview error, never a truncated image. */
export const PREVIEW_POLICY = {
    maxConcurrentRenders: 3,
    renderTimeoutMs: 30_000,
    navigationTimeoutMs: 15_000,
    callerTimeoutMs: 35_000,
    maxRedirects: 5,
    maxResponseBytes: 10 * 1024 * 1024,
    maxConnections: 128,
    maxRequests: 256,
    maxTransferredBytes: 32 * 1024 * 1024,
    requestBodyBytes: 10_240,
    keepAliveTimeoutMs: 35_000,
    headersTimeoutMs: 36_000,
} as const;
export const MAX_APPROVED_SOURCE_BYTES = 16 * 1024 * 1024;
export const MAX_NORMALIZED_ARTIFACT_BYTES = 16 * 1024 * 1024;
export const MAX_CAPTURE_OBSERVED_METADATA_BYTES = 192 * 1024;
export const MAX_EVIDENCE_ARTIFACT_BYTES = 16 * 1024 * 1024;
export const MAX_PREPARATION_DIAGNOSTIC_BYTES = 64 * 1024;

// Extraction capacities; overflow must remain explicit, never an implied complete reading.
export const MAX_PDF_PAGES = 400;
export const MAX_PASSAGES_PER_SOURCE = 512;
export const MAX_QUOTATION_CHARS = 4000;
export const MAX_REDIRECTS = 5;
/** Immutable research window of the existing Sources qualification contract, not a generation timeout. */
export const SOURCES_QUALIFICATION_RESEARCH_WINDOW_MS = 15 * 60_000;
/** Only for inspecting historical dossiers without versioned accounting. */
export const LEGACY_PREPARATION_MODEL_ATTEMPT_LIMIT = 120;
export const MAX_SUPPLEMENT_SEARCHES = 3;
export const MAX_SUPPLEMENT_CANDIDATES = 12;
export const MAX_HISTORICAL_SOURCE_CANDIDATES = 60;

// Domain input capacities: counts and UTF-16 code units, not byte or token quantities.
export const MAX_CLAIMS_PER_RUN = 128;
export const MAX_EVIDENCE_PER_CLAIM = 32;
export const MAX_DIMENSION_LINKS_PER_CLAIM = 10;
export const MAX_CLAIM_STATEMENT_CHARS = 1000;
export const MAX_CLAIM_RATIONALE_CHARS = 2000;
export const MAX_CLAIM_INPUT_PASSAGES = 4096;

// Embedding representation and conservative exposure; these are not measured token charges.
export const SOURCE_EMBEDDING_DIMENSIONS = 1024;
export const MAX_SOURCE_EMBEDDING_BATCH_TEXTS = 32;
export const MAX_SOURCE_EMBEDDING_TEXT_BYTES = 6000;
export const SOURCE_EMBEDDING_PRICE_CEILING_PER_MILLION_TOKENS = 0.012;
export const MAX_SOURCE_EMBEDDING_INPUT_BYTES = Math.floor(
    (0.01 * 1_000_000) / SOURCE_EMBEDDING_PRICE_CEILING_PER_MILLION_TOKENS,
);
export const MAX_SOURCE_EMBEDDING_ATTEMPTS = 128;
export const MAX_CONCURRENT_SOURCE_EMBEDDING_CALLS = 2;
export const MAX_SOURCE_SEARCH_CANDIDATES = 20_000;
export const MAX_SOURCE_SEARCH_BLOCKS = 100_000;

// Replay storage capacity and writer renewal are independent of generation deadlines.
export const PI_SESSION_MAX_BYTES = 32 * 1024 * 1024;
export const PI_COMMIT_MAX_BYTES = 512 * 1024;
export const PI_LEASE_RENEW_INTERVAL_MS = 25_000;
export const PI_SESSION_LEASE_MS = 90_000;
export const PI_REPLAY_PAGE_SIZE = 256;
export const PI_REPLAY_PAGE_MAX_BYTES = 2 * 1024 * 1024;
export const PI_WORKER_SLICE_MS = 80_000;
export const PI_RETAINED_OPERATION_BATCH = 20;
export const PI_OPERATION_WAIT_POLL_MS = 30_000;

// Whole-mission authority, bounded history and structured-transport representations.
// These byte capacities are not native model-context token limits.
export const EXECUTION_WINDOW_MS = 15 * 60 * 1000;
export const HISTORY_PAGE_SIZE = 20;
/** Recent operation rows per conversation/mission preview; overflow remains inspectable in history. */
export const WORKBENCH_OPERATION_PREVIEW_SIZE = 32;
/** Completed operations one Workbench turn may record; reaching it blocks the turn as out of context capacity. */
export const MAX_WORKBENCH_TURN_OPERATIONS = 128;
export const MAX_CONTEXT_BYTES = 128 * 1024;
export const MAX_OBSERVABLE_OUTPUT_BYTES = 512 * 1024;
export const MAX_WORKING_NOTES_BYTES = 16 * 1024;
export const MAX_NO_PROGRESS_TURNS = 3;
export const MAX_HISTORY_RESULT_BYTES = 48 * 1024;
export const MAX_CONVERSATION_SCAN = 4096;
export const RESPONSE_CONTROL_MAX_INPUT_BYTES = 32 * 1024;

// Acquisition and metadata clocks/retries, not generation completion estimates.
export const MAX_SEC_ATTEMPTS = 2;
export const DEFAULT_SEC_TIMEOUT_MS = 10_000;
export const MAX_EXA_CONTENTS_ATTEMPTS = 2;
export const MAX_EXA_TEXT_CHARACTERS = 1_000_000;
export const DEFAULT_EXA_CONTENTS_TIMEOUT_MS = 120_000;
export const COMPANY_PREFLIGHT_TTL_MS = 15 * 60 * 1000;
export const COMPANY_WEBSITE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const COMPANY_WEBSITE_TIMEOUT_MS = 5_000;
export const MANUAL_SOURCE_MAX_REDIRECTS = 5;
export const MANUAL_SOURCE_METADATA_MAX_BYTES = 2 * 1024 * 1024;
export const MANUAL_SOURCE_METADATA_TIMEOUT_MS = 10_000;
export const MANUAL_SOURCE_PREPARATION_TTL_MS = 10 * 60_000;

/** Per-boundary abuse and provider-rate admission. Periods are milliseconds; rates are event counts. */
export const RATE_LIMITS = {
    secRequests: { kind: "token bucket", rate: 8, period: 1000 },
    exaWebsiteGlobal: { kind: "fixed window", rate: 25, period: 15 * 60_000 },
    exaWebsitePerUser: { kind: "fixed window", rate: 12, period: 15 * 60_000 },
    sourceMetadataGlobal: {
        kind: "fixed window",
        rate: 60,
        period: 15 * 60_000,
    },
    sourceMetadataPerUser: {
        kind: "fixed window",
        rate: 12,
        period: 15 * 60_000,
    },
    invitationClaimGlobal: {
        kind: "fixed window",
        rate: 25,
        period: 15 * 60_000,
    },
    invitationClaimPerUser: {
        kind: "fixed window",
        rate: 5,
        period: 15 * 60_000,
    },
    previewRender: { kind: "fixed window", rate: 2, period: 30_000 },
} as const;

export const ADMIN_RECENT_EVENT_LIMIT = 50;

/**
 * Centralized string/payload bounds for policy evaluations and the bounded
 * deterministic verifier. Enforced at the verifier registration/execution
 * boundary and at the policy commit boundary before any row is written.
 * Keeping the ceilings here gives the shared responsibility a single owner.
 */
export const MAX_POLICY_RULE_ID_CHARS = 64;

export const MAX_POLICY_REASON_CODE_CHARS = 64;

export const MAX_POLICY_SOURCE_ID_CHARS = 128;

export const MAX_POLICY_SOURCE_CATEGORY_CHARS = 64;

export const MAX_POLICY_PUBLISHER_IDENTITY_CHARS = 128;

export const MAX_POLICY_SOURCE_SEC_FORM_CHARS = 64;

export const MAX_POLICY_INPUT_HASH_CHARS = 128;

export const MAX_VERIFIER_STATEMENT_CHARS = 1000;

export const MAX_VERIFIER_REFERENCE_IDENTITY_CHARS = 256;

export const MAX_VERIFIER_INPUT_HASH_CHARS = 128;

// Shared cap on verifier output evidence reference arrays, enforced at both
// the adapter boundary and the policy commit boundary before any insert.
export const MAX_VERIFIER_EVIDENCE_REFERENCES = 32;

/** Throws when a string is longer than the configured ceiling for its field. */
export function assertWithinLength(
    value: string,
    max: number,
    label: string,
): void {
    if (typeof value !== "string" || value.length > max) {
        throw new Error(`${label} exceeds upper bound of ${max} chars`);
    }
}

export const MAX_FRAMING_AUTHORITY_REVISIONS = 128;

// Reserve the remaining result budget for documentary permissions and observed-link previews.
export const MAX_SAVED_MATERIAL_SEARCH_RESULT_BYTES = 30 * 1024;

export const MAX_INSPECTED_CAPTURES = 64;

export const SOURCE_COMPARISON_MAX_INPUT_BYTES = 128 * 1024;

export const SOURCE_COMPARISON_MAX_FINDINGS = 15;

export const SOURCE_COMPARISON_MAX_CANDIDATES = 60;

export const SOURCE_COMPARISON_MAX_PRIMARY_CAPTURES = 8;

export const SOURCE_COMPARISON_MAX_PASSAGES_PER_FINDING = 6;

export const SOURCE_COMPARISON_MAX_CONTEXT_PASSAGES_PER_FINDING = 2;

export const SOURCE_COMPARISON_MAX_PRIMARY_PASSAGES = 64;

export const SOURCE_COMPARISON_CONTEXT_EXPANSION_BYTES = 32 * 1024;

export const SOURCE_COMPARISON_MAX_OUTPUT_BYTES = 700 * 1024;

export const SOURCE_COMPARISON_MAX_AGGREGATE_CAPTURE_BYTES = 32 * 1024 * 1024;

export const MAX_QUALIFICATION_INPUT_BYTES = 128 * 1024;

export const MAX_QUALIFICATION_FINDINGS = 15;

export const MAX_SOURCE_CONTRIBUTIONS_PER_ROLE = 2;

// A proposal stores comparison references in one Convex array; this is a format capacity, not an attempt allowance.
export const MAX_COMPARISON_HISTORY_REFERENCES = 8192;

/** Leaves room under Convex's transaction ceilings for authority, preparation and lifecycle reads. */
export const SOURCES_HANDOFF_READ_CAPACITY = {
    bytes: 10 * 1024 * 1024,
    ranges: 3072,
} as const;

export const SOURCES_MAX_EVIDENCE_REFERENCES = 8;

/** Analyst reader excerpts: cited passages with one neighbour each side, or the opening of an unqualified capture. The original stays one link away. */
export const SOURCES_READER_CONTEXT_PASSAGES = 1;
export const SOURCES_READER_OPENING_PASSAGES = 12;

/** Records removed per dossier-purge transaction; a byte-safe batch under Convex write limits, not a purge allowance. */
export const DOSSIER_PURGE_BATCH = 100;

export const SOURCES_MAX_QUALIFICATION_CONTRIBUTIONS = 15;

export const MAX_EXA_DISCOVERY_ATTEMPTS = 2;

export const EXA_DISCOVERY_TIMEOUT_MS = 10_000;

// A fragment stays comfortably below Convex's document and argument limits.
export const TEXT_FRAGMENT_CHARACTERS = 60 * 1024;

export const MODEL_MAX_INPUT_PRICE_PER_MILLION = 0.15;

export const MODEL_MAX_OUTPUT_PRICE_PER_MILLION = 0.6;

export const MAX_PDF_ATTEMPTS = 2;

export const PDF_REQUEST_TIMEOUT_MS = 10_000;

export const MAX_QUALIFICATION_CONTEXT_DURATION_MS = 2 * 60 * 60 * 1000;

export const SOURCE_SELECTION_PROPOSAL_MAX_ATTEMPTS = 2;

export const SOURCE_SELECTION_PROPOSAL_TIMEOUT_MS = 10_000;

/** Non-generative default receipt fences retain existing settlement headroom. These are not generation deadlines. */
export const IO_SETTLEMENT_GRACE_MS = 5_000;
export const EXA_CONTENTS_SETTLEMENT_GRACE_MS = 30_000;
export const IO_PROVIDER_LEASE_MS = {
    sec: DEFAULT_SEC_TIMEOUT_MS + IO_SETTLEMENT_GRACE_MS,
    exa: EXA_DISCOVERY_TIMEOUT_MS + IO_SETTLEMENT_GRACE_MS,
    url_metadata: MANUAL_SOURCE_METADATA_TIMEOUT_MS + IO_SETTLEMENT_GRACE_MS,
    pdf: PDF_REQUEST_TIMEOUT_MS + IO_SETTLEMENT_GRACE_MS,
    exaContents:
        DEFAULT_EXA_CONTENTS_TIMEOUT_MS + EXA_CONTENTS_SETTLEMENT_GRACE_MS,
    companyWebsite: COMPANY_WEBSITE_TIMEOUT_MS + IO_SETTLEMENT_GRACE_MS,
} as const;
/** Billing lookup exclusivity/recheck interval, never evidence that a generation finished. */
export const BILLING_LOOKUP_LEASE_MS = 30_000;

/** Cumulative model-response wire bytes, including SSE framing and reasoning. Adequacy remains unverified. */
export const MODEL_WIRE_RESPONSE_MAX_BYTES = 1024 * 1024;
export const REVIEW_WIRE_RESPONSE_MAX_BYTES = 1024 * 1024;
/** Valid decoded UTF-16 units cannot exceed original UTF-8 byte count. This is only a coarse cache-shape check. */
export const REVIEW_CACHED_RESPONSE_MAX_CHARACTERS =
    REVIEW_WIRE_RESPONSE_MAX_BYTES;
export const REVIEW_REPORT_MAX_BYTES = 256 * 1024;
/** Local frozen-evidence paging/retention, not native context capacity. Overflow is explicit or cursor-backed. */
export const REVIEW_EVIDENCE_POLICY = {
    inventoryPageSize: 50,
    maxInventoryPageSize: 100,
    searchPageSize: 50,
    maxSearchResults: 100,
    maxSearchFiles: 100,
    maxSearchPatternBytes: 8192,
    searchPreviewCharacters: 8192,
    searchLeadingCharacters: 100,
    defaultReadBytes: 8192,
    maxPageBytes: 50 * 1024,
    maxFileBytes: 64 * 1024 * 1024,
    maxSnapshotBytes: 256 * 1024 * 1024,
} as const;

export const PREPARATION_RECOVERY_COOLDOWN_MS = 15_000;

// Default safety window before cleanup may delete an unattached storage object
// or mark an expired upload lease reconciled. Crashed/abandoned uploads are
// tolerated only inside this window; recent in-flight uploads are always kept.
export const ARTIFACT_CLEANUP_SAFETY_INTERVAL_DEFAULT_MS = 24 * 60 * 60 * 1000;

export const ARTIFACT_CLEANUP_PAGE_SIZE = 100;

export const MAX_EXTRACTION_TASK_SCAN = 16;

export const MAX_POLICY_EVAL_SCAN = 16;

export const CANCELLATION_MISSION_BATCH = 4;

export const CANCELLATION_REQUEST_BATCH = 4;

export const MAX_VALIDATION_FEEDBACK_FIELD_CHARS = 256;

export const MAX_PROGRESS_FACTS = 256;

export const MAX_POLICY_RULES = 16;

export const MAX_POLICY_REASON_CODES = 16;

/** Persisted Sources envelopes retain their granted counts; these are admission/representation ceilings. */
export const SOURCES_ENVELOPE_MAX_COUNT = 160;
export const SOURCES_ENVELOPE_MAX_ACQUISITIONS = 60;
export const SOURCES_WORK_ENTRY_CAPACITY = 160;

/** Scheduling, publication recovery and known-terminal settlement; none grants model dispatch authority. */
export const NATIVE_WORKER_POLICY = {
    publicationRecoveryMaxWorkers: 16,
    publicationHoldPollMs: 5_000,
    resumeDelayMs: 1_000,
    settlementMaxAttempts: 3,
    settlementRetryBaseMs: 1_000,
} as const;

/** Runner wait/capture capacities, separate from generation deadlines and immutable campaign authority. */
export const QUALIFICATION_TOOLING_POLICY = {
    worktreeLookupMaxBufferBytes: 256 * 1024,
    candidateValidationTimeoutMs: 300_000,
    localCommandTimeoutMs: 30_000,
    backendCommandTimeoutMs: 120_000,
    archiveCommandTimeoutMs: 120_000,
    captureDownloadTimeoutMs: 30_000,
    backendRequestTimeoutMs: 120_000,
    sessionRefreshAheadMs: 30_000,
    admissionInteractionTimeoutMs: 30_000,
    preflightChecksTimeoutMs: 40 * 60_000,
    browserInteractionTimeoutMs: 20_000,
    liveObservationTimeoutMs: 900_000,
    deterministicObservationTimeoutMs: 120_000,
    sourcePauseTimeoutMs: 120_000,
    legacyMissionSettleTimeoutMs: 240_000,
    legacyContextDurationMs: 35 * 60_000,
    sourcesContextDurationMs: 40 * 60_000,
    gateObservationTimeoutMs: 65_000,
    refusalRecoveryMaxWaitMs: 60_000,
    publishedSnapshotMaxBytes: 262_144,
    relayGateTimeoutMs: 20_000,
    relayGatePollMs: 25,
    relayRefusalCooldownMs: 15_000,
    relayRequestMaxBytes: 131_072,
    relayResponseMaxBytes: 1_048_576,
    observationIntervalsMs: [500, 1_000],
    legacyObservationIntervalsMs: [1_000, 2_000],
    gateObservationIntervalsMs: [100, 500],
} as const;

/** Non-generative network clocks: catalogues, billing facts, embeddings and public-address validation. */
export const MODEL_METADATA_REQUEST_TIMEOUT_MS = 15_000;
export const MODEL_CATALOG_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const MODEL_CATALOG_MAX_ROWS = 8192;
export const MODEL_CATALOG_MAX_ENDPOINTS = 256;
/** CPU-only native request-profile preparation, not provider generation. */
export const NATIVE_PROFILE_PREPARATION_TIMEOUT_MS = 60_000;
export const MODEL_CATALOG_REFRESH_TIMEOUT_MS = 60_000;
export const GENERATION_BILLING_LOOKUP_TIMEOUT_MS = 15_000;
export const GENERATION_BILLING_MAX_RESPONSE_BYTES = 64 * 1024;
export const SOURCE_EMBEDDING_REQUEST_TIMEOUT_MS = 30_000;
export const SOURCE_EMBEDDING_MAX_RESPONSE_BYTES = 1024 * 1024;
export const SOURCE_PUBLIC_ADDRESS_TIMEOUT_MS = 20_000;

/** Independent cursor-backed database pages. A page size is not a total-work cutoff. */
export const PERSISTENCE_PAGE_SIZE = {
    sourceRetrieval: 64,
    runContextCleanup: 20,
    nativeInputs: 20,
    qualificationAccounting: 32,
    qualificationLots: 32,
    qualificationFixtures: 32,
    researchResumeRequests: 20,
    nativeRebind: 20,
} as const;
export const SOURCES_HANDOFF_BASE_READ_RESERVE_BYTES = 64 * 1024;

/** Local process/ownership probes and archive subprocesses; independent from application mission authority. */
export const GIT_METADATA_TIMEOUT_MS = 5_000;
export const LOCAL_RUNTIME_POLICY = {
    maxStartupTimeoutMs: 600_000,
    portReservationTimeoutMs: 20_000,
    unlockTimeoutMs: 2_000,
    backendIdentityTimeoutMs: 3_000,
    webIdentityTimeoutMs: 2_000,
    previewIdentityTimeoutMs: 2_000,
    manifestWriteTimeoutMs: 5_000,
    portInspectionTimeoutMs: 5_000,
    portInspectionMaxBufferBytes: 4 * 1024 * 1024,
    processStopPollMs: 25,
    interruptGraceMs: 1_500,
    terminateGraceMs: 1_000,
    killGraceMs: 500,
    backendReadinessPollMs: 250,
    previewReadinessPollMs: 100,
    webReadinessPollMs: 150,
    previewReadinessProbeTimeoutMs: 1_000,
} as const;
export const EVALUATION_ARCHIVE_POLICY = {
    commandTimeoutMs: 120_000,
    commandMaxBufferBytes: 1024 * 1024,
} as const;

/** Evaluation metadata, local retrieval transport and log collection, not experimental generation conditions. */
export const EVALUATION_IO_POLICY = {
    catalogRequestTimeoutMs: 30_000,
    inspectionIdentityTimeoutMs: 5_000,
    inspectionBackendRequestTimeoutMs: 180_000,
    nativeLogPageTimeoutMs: 30_000,
    nativeLogIdlePollMs: 250,
    nativeLogFailureBackoffMs: 1_000,
    preparationObservationPollMs: 1_000,
    workflowStepInspectionPageSize: 1_000,
} as const;

/** Local publication subprocess budget; outer coordination still derives its guard headroom. */
export const LOCAL_PUBLICATION_TIMEOUT_MS = 10 * 60_000;
export const LOCAL_PUBLICATION_GUARD_TIMEOUT_MS = 5_000;
export const LOCAL_PUBLICATION_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
/** Lock-owning parent includes publisher plus the existing six identity/guard/startup probes. */
export const LOCAL_PUBLICATION_COMMAND_TIMEOUT_MS =
    LOCAL_PUBLICATION_TIMEOUT_MS + 6 * LOCAL_PUBLICATION_GUARD_TIMEOUT_MS;
export const WORKSPACE_DOSSIER_INITIAL_PAGE_SIZE = 12;
export const ADMIN_BACKFILL_PAGE_MAX_ITEMS = 10;
export const ADMIN_JOURNAL_PAGE_MAX_ITEMS = 20;
/** Initial cursor pages; changing these does not truncate the complete collection. */
export const CLIENT_PAGE_SIZE = {
    adminDossiers: 20,
    adminReservations: 20,
    adminProviderCalls: 20,
    adminJournalEvents: ADMIN_JOURNAL_PAGE_MAX_ITEMS,
    invocationPayloadFragments: 1,
    evidenceMatrix: 10,
} as const;
/** Admission ceiling for a separately authorized analysis window, never a per-call timer. */
export const MAX_REVIEW_AUTHORITY_DURATION_MS = 15 * 60_000;

/** Validate required configuration without a fallback: undefined when missing/blank, throws if invalid. */
export function requiredPositiveInteger(
    value: string | undefined,
    label: string,
    maximum: number,
): number | undefined {
    if (value === undefined || value.trim().length === 0) return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum)
        throw new Error(`${label} must be an integer between 1 and ${maximum}`);
    return parsed;
}

/** Validate configuration at the caller's boundary without reading its environment. */
export function configuredPositiveInteger(
    value: string | undefined,
    fallback: number,
    label: string,
    maximum = MAX_CONFIGURED_COLLECTION_LIMIT,
): number {
    return requiredPositiveInteger(value, label, maximum) ?? fallback;
}

export function resolveSourceRecommendedTarget(
    candidateLimit: number,
    value: string | undefined,
    preparation = false,
): number {
    const ceiling = configuredPositiveInteger(
        value,
        preparation
            ? MAX_PREPARED_RECOMMENDATIONS
            : Math.ceil(candidateLimit / 2),
        "Source recommendation ceiling",
    );
    if (ceiling > candidateLimit)
        throw new Error(
            "Source recommendation ceiling must not exceed source candidate limit",
        );
    return preparation
        ? Math.min(MAX_PREPARED_RECOMMENDATIONS, ceiling)
        : ceiling;
}

export function resolvePreviewCacheTtlMs(value: string | undefined): number {
    if (value === undefined || value.trim().length === 0)
        return DEFAULT_PREVIEW_CACHE_TTL_MS;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < MIN_PREVIEW_CACHE_TTL_MS)
        throw new Error(
            `PREVIEW_CACHE_TTL_MS must be an integer >= ${MIN_PREVIEW_CACHE_TTL_MS}`,
        );
    return parsed;
}

export function resolvePreparationModelLimits(
    workValue?: string,
    incidentValue?: string,
) {
    const read = (value: string | undefined, fallback: number) => {
        if (value === undefined || value.trim() === "") return fallback;
        const limit = Number(value);
        if (!Number.isSafeInteger(limit) || limit < 1)
            throw new Error(
                "Preparation limits must be positive safe integers",
            );
        return limit;
    };
    const work = read(workValue, 120);
    const incidents = read(incidentValue, 40);
    if (!Number.isSafeInteger(work + incidents))
        throw new Error("Combined preparation limit must be a safe integer");
    return { work, incidents };
}

/** Written justification required for administrative and recovery actions recorded in the audit log. */
export const MIN_AUDIT_REASON_CHARS = 12;
export const MAX_AUDIT_REASON_CHARS = 500;
