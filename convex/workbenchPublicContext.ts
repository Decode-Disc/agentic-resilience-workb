import type { Id } from "@convex/_generated/dataModel";
import { internalQuery, type QueryCtx } from "@convex/_generated/server";
import {
    canonicalFramingUrl,
    confirmedFramingFiling,
    messageSuppliesFramingUrl,
    observedFramingCandidate,
    requireFramingAcquisitionRequest,
} from "@convex/domain/documentaryAccess";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { authorizeDocumentaryDiscovery } from "@convex/domain/sources";
import {
    explicitFramingPreservation,
    explicitResearchCommand,
    framingObservationRefusal,
    publicContextAllowanceValidator,
    publicReadResultValidator,
    retainedPublicReadPage,
    supportsDirectedFraming,
    supportsFramingContractCorrections,
} from "@convex/domain/workbenchContracts";
import { requireMissionAuthority } from "@convex/execution/authority";
import {
    conversationInstructions,
    requireInstructionVersion,
} from "@convex/execution/conversations";
import { executionError } from "@convex/execution/errors";
import { historyTextFragment } from "@convex/execution/journal";
import { missionScope } from "@convex/execution/missionData";
import { operationObservationRange } from "@convex/execution/retainedText";
import { secSubmissionsUrl } from "@convex/integrations/sec";
import {
    framingReplaySchema,
    resolveFramingReplay,
} from "@convex/qualificationCampaignPolicy";
import { requireCampaignLot } from "@convex/qualificationCampaigns";
import {
    DOCUMENTARY_SEARCH_QUERY_MAX_CHARS,
    MAX_OPERATION_RESULT_BYTES,
    SOURCES_ENVELOPE_MAX_COUNT,
} from "@convex/resourcePolicy";
import {
    readWorkbenchQualification,
    requireBrowserFixtureContext,
    requireBrowserTestRunOwner,
} from "@convex/runWorkspace";
import { type Infer, v } from "convex/values";
import { zodToConvex } from "convex-helpers/server/zod4";
import { validate } from "convex-helpers/validators";

type SuppliedReference = {
    url: string;
    publishedAt?: number;
    confirmedSec?: { cik: string; accession: string };
};

/** The ledger and transport derive the same input for each authorized SEC read. */
export function framingSecReadInput(
    reference: SuppliedReference | undefined,
    stepKey: string | undefined,
) {
    if (!reference?.confirmedSec) return undefined;
    const identity = reference.confirmedSec;
    if (stepKey === "sec_filing") return { ...identity, url: reference.url };
    if (stepKey === "sec_submissions" && reference.publishedAt === undefined)
        return { ...identity, url: secSubmissionsUrl(identity.cik) };
    return undefined;
}

/** Retained receipts keep their original input identity. Canonical acquisition also binds the admitted target. */
export function framingProviderInputHash(
    input: unknown,
    acquisitionInputHash?: string,
) {
    return sha256Hex(
        stableStringify(
            acquisitionInputHash === undefined
                ? input
                : { acquisitionInputHash, input },
        ),
    );
}

/** Pin an explicitly configured cumulative framing allowance on new dossiers only. */
export function configuredPublicContextAllowance() {
    let value: unknown;
    try {
        value = JSON.parse(
            process.env.WORKBENCH_PUBLIC_CONTEXT_ALLOWANCE ?? "null",
        );
    } catch {
        return undefined;
    }
    return validate(publicContextAllowanceValidator, value) &&
        [value.searches, value.readings].every(
            (limit) =>
                Number.isSafeInteger(limit) &&
                limit > 0 &&
                limit <= SOURCES_ENVELOPE_MAX_COUNT,
        )
        ? value
        : undefined;
}

/** The same claimed-turn fence protects provider admission and observation adoption. */
export async function requirePublicContextRequest(
    ctx: QueryCtx,
    requestId: Id<"agentOperationRequests">,
    expectedGeneration: number,
) {
    const request = await ctx.db.get(requestId);
    const acquisition =
        request?.input.kind === "acquire_document"
            ? await requireFramingAcquisitionRequest(
                  ctx,
                  requestId,
                  expectedGeneration,
              )
            : undefined;
    if (
        !request?.missionId ||
        (!acquisition &&
            ((request.input.kind !== "verify_public_context" &&
                request.input.kind !== "search_public_context" &&
                request.input.kind !== "read_public_context") ||
                request.status !== "running" ||
                request.expectedGeneration !== expectedGeneration))
    )
        throw executionError("request_unavailable");
    const { run, mission } =
        acquisition ??
        (await requireMissionAuthority(
            ctx,
            request.missionId,
            expectedGeneration,
        ));
    await requireInstructionVersion(ctx, mission, request.instructionVersion);
    if (
        (request.input.kind === "search_public_context" ||
            request.input.kind === "read_public_context") &&
        !supportsDirectedFraming(mission.definitionVersion)
    )
        throw executionError("operation_not_allowed");
    const turn = mission.conversationTurnId
        ? await ctx.db.get(mission.conversationTurnId)
        : null;
    if (
        turn?.responseControl?.correction?.instructionVersion ===
            request.instructionVersion &&
        turn?.responseControl?.correction
    )
        throw executionError("instruction_not_authorized");
    const scope = missionScope(mission);
    const company = run.companySnapshot;
    if (
        scope.kind !== "workbench_v1" ||
        !company ||
        run.lifecycleState !== "framing" ||
        run.researchStartedAt !== undefined ||
        request.runId !== run._id ||
        !run.currentFramingRevisionId ||
        (!acquisition &&
            (request.pin?.kind !== "framing_revision" ||
                request.pin.revisionId !== run.currentFramingRevisionId))
    )
        throw executionError("framing_version_conflict");
    const messageId =
        acquisition?.pin.scope.cause.messageId ??
        ("messageId" in request.input ? request.input.messageId : undefined);
    const instructions = acquisition
        ? undefined
        : await conversationInstructions(ctx, mission);
    if (
        !acquisition &&
        (!instructions?.messages.some(
            (message) =>
                message.messageId === messageId &&
                !explicitResearchCommand(message.text),
        ) ||
            instructions.messages.some((message) =>
                explicitFramingPreservation(message.text),
            ))
    )
        throw executionError("instruction_not_authorized");
    let selectedCandidate: { url: string; publishedAt?: string } | undefined;
    if (
        request.input.kind === "read_public_context" &&
        request.input.target.kind === "candidate"
    ) {
        const { searchId, index } = request.input.target;
        selectedCandidate = await observedFramingCandidate(
            ctx,
            searchId,
            index,
            {
                ...request,
                messageId,
            },
        );
    }
    if (
        request.input.kind === "search_public_context" &&
        !supportsFramingContractCorrections(mission.definitionVersion) &&
        request.input.focus !== undefined
    )
        throw executionError("operation_not_allowed");
    const query = acquisition
        ? acquisition.reference.url
        : request.input.kind === "search_public_context" &&
            supportsFramingContractCorrections(mission.definitionVersion)
          ? authorizeDocumentaryDiscovery(run.coveragePreset, request.input)
                .query
          : request.input.kind === "read_public_context"
            ? request.input.target.kind === "supplied"
                ? request.input.target.url
                : (selectedCandidate?.url ?? "")
            : "query" in request.input
              ? request.input.query.trim()
              : "";
    if (
        !query ||
        (!acquisition &&
            request.input.kind !== "read_public_context" &&
            query.length > DOCUMENTARY_SEARCH_QUERY_MAX_CHARS)
    )
        throw executionError("discovery_query_invalid");
    let allowance = run.publicContextAllowance;
    let qualificationDeadline: number | undefined;
    let replay: import("zod").infer<typeof framingReplaySchema> | undefined;
    if (run.purpose === "browser_test") {
        const qualification = await readWorkbenchQualification(ctx, run);
        const context = run.browserTestContextId
            ? await ctx.db.get(run.browserTestContextId)
            : null;
        const binding = (
            qualification?.scenarios ?? context?.simulatedScenarios
        )?.find((entry) => entry.runId === run._id);
        if (!binding || !context?.campaignLotId)
            throw executionError("paid_work_disabled");
        const { lot, campaign } = await requireCampaignLot(
            ctx,
            context.campaignLotId,
        );
        const scenario =
            campaign.manifest.version === 1
                ? undefined
                : campaign.manifest.scenarios.find(
                      (entry) => entry.id === binding.id,
                  );
        if (!scenario?.framingPublicContext)
            throw executionError("paid_work_disabled");
        if (scenario.framingReplay) {
            const visitor = await requireBrowserTestRunOwner(ctx, run);
            if (
                (await requireBrowserFixtureContext(ctx, visitor)) !==
                    context._id ||
                !supportsDirectedFraming(mission.definitionVersion)
            )
                throw executionError("instruction_not_authorized");
            replay = resolveFramingReplay(campaign.manifest, scenario);
            qualificationDeadline = Math.min(
                context.expiresAt,
                campaign.manifest.expiresAt,
            );
            allowance = { searches: 0, readings: 0 }; // Frozen operations perform no external I/O or provider reservation.
        } else {
            if (!qualification) throw executionError("paid_work_disabled");
            allowance = {
                searches: Math.min(
                    lot.allocation.search,
                    scenario.limits?.search ?? Infinity,
                ),
                readings: Math.min(
                    lot.allocation.acquisition,
                    scenario.limits?.acquisition ?? Infinity,
                ),
            };
            qualificationDeadline = qualification.deadlineAt;
        }
    }
    if (!allowance)
        throw executionError("public_context_allowance_unavailable");
    let suppliedReference: SuppliedReference | undefined =
        acquisition?.reference;
    if (
        !acquisition &&
        request.input.kind !== "search_public_context" &&
        /^https?:\/\//iu.test(query)
    ) {
        const canonicalUrl = canonicalFramingUrl(query);
        if (!canonicalUrl) throw executionError("source_url_not_public");
        const source = await ctx.db
            .query("sources")
            .withIndex("by_run_and_url", (q) =>
                q.eq("runId", run._id).eq("canonicalUrl", canonicalUrl),
            )
            .first();
        const original =
            instructions?.messages.find(
                (message) => message.messageId === messageId,
            )?.text ?? "";
        if (
            !selectedCandidate &&
            !messageSuppliesFramingUrl(original, canonicalUrl) &&
            source?.origin !== "analyst_url"
        )
            throw executionError("source_reference_not_observed");
        suppliedReference = {
            url: canonicalUrl,
            publishedAt: selectedCandidate?.publishedAt
                ? Date.parse(selectedCandidate.publishedAt)
                : source?.publishedAt,
            confirmedSec: confirmedFramingFiling(canonicalUrl, company.cik),
        };
    }
    let retainedRead: Infer<typeof publicReadResultValidator> | undefined;
    if (
        request.input.kind === "read_public_context" &&
        request.input.continuation
    ) {
        const previous = await ctx.db.get(request.input.continuation);
        const refusal = framingObservationRefusal(previous, {
            ...request,
            messageId,
        });
        if (refusal) throw executionError(refusal);
        if (
            previous?.input.kind !== "read_public_context" ||
            previous.outcome?.kind !== "success"
        )
            throw executionError("source_reference_not_observed");
        if (
            stableStringify(previous.input.target) !==
            stableStringify(request.input.target)
        )
            throw executionError("source_continuation_invalid");
        const value: unknown = JSON.parse(previous.outcome.valueJson);
        if (
            !validate(publicReadResultValidator, value) ||
            value.continuation !== previous._id ||
            !value.document ||
            !value.range ||
            !value.reference
        )
            throw executionError("source_continuation_invalid");
        retainedRead = value;
    }
    return {
        mission,
        run,
        operation: request.input.kind,
        allowance,
        qualificationDeadline,
        query: `${company.legalName}: ${query}`,
        suppliedReference,
        selectedCandidate:
            acquisition?.selectedCandidate ?? !!selectedCandidate,
        acquisitionInputHash: acquisition?.pin.target.requestInputHash,
        retainedRead,
        replay,
    };
}

export const forExecution = internalQuery({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
    },
    returns: v.object({
        replay: v.optional(zodToConvex(framingReplaySchema)),
        missionId: v.id("agentMissions"),
        runId: v.id("researchRuns"),
        corpusRevisionId: v.optional(v.id("corpusRevisions")),
        workflowVersion: v.number(),
        operation: v.union(
            v.literal("verify_public_context"),
            v.literal("search_public_context"),
            v.literal("read_public_context"),
            v.literal("acquire_document"),
        ),
        deadlineAt: v.number(),
        acquisitionInputHash: v.optional(v.string()),
        query: v.string(),
        selectedCandidate: v.boolean(),
        retainedRead: v.optional(publicReadResultValidator),
        suppliedReference: v.optional(
            v.object({
                url: v.string(),
                publishedAt: v.optional(v.number()),
                confirmedSec: v.optional(
                    v.object({ cik: v.string(), accession: v.string() }),
                ),
            }),
        ),
    }),
    handler: async (ctx, args) => {
        const {
            mission,
            run,
            operation,
            selectedCandidate,
            retainedRead,
            query,
            suppliedReference,
            acquisitionInputHash,
            qualificationDeadline,
            replay,
        } = await requirePublicContextRequest(
            ctx,
            args.requestId,
            args.expectedGeneration,
        );
        return {
            ...(replay ? { replay } : {}),
            missionId: mission._id,
            runId: run._id,
            corpusRevisionId: run.activeCorpusRevisionId,
            workflowVersion: mission.definitionVersion,
            operation: operation as
                | "verify_public_context"
                | "search_public_context"
                | "read_public_context"
                | "acquire_document",
            selectedCandidate,
            ...(retainedRead ? { retainedRead } : {}),
            deadlineAt: Math.min(
                mission.deadlineAt,
                qualificationDeadline ?? Infinity,
            ),
            query,
            acquisitionInputHash,
            ...(suppliedReference ? { suppliedReference } : {}),
        };
    },
});

/** Continuations derive the next offset from an adopted page, never from an arbitrary caller position. */
export const readingPage = internalQuery({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
    },
    returns: retainedPublicReadPage,
    handler: async (ctx, args) => {
        const authority = await requirePublicContextRequest(
            ctx,
            args.requestId,
            args.expectedGeneration,
        );
        if (authority.operation !== "read_public_context")
            throw executionError("request_unavailable");
        if (authority.retainedRead)
            throw executionError("source_continuation_invalid");
        const root = args.requestId;
        const start = 0;
        const limit = Math.floor(MAX_OPERATION_RESULT_BYTES / 8);
        const text = await operationObservationRange(
            ctx,
            root,
            start,
            limit + 1,
        );
        if (!text) throw executionError("source_read_unavailable");
        const fragment =
            text.characters === 0
                ? { end: 0, content: "" }
                : historyTextFragment(text.content, 0, limit);
        return {
            readId: root,
            contentHash: text.contentHash,
            characters: text.characters,
            start,
            end: start + fragment.end,
            excerpt: fragment.content,
        };
    },
});
