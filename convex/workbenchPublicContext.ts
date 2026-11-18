import type { Id } from "@convex/_generated/dataModel";
import { internalQuery, type QueryCtx } from "@convex/_generated/server";
import {
    explicitFramingPreservation,
    explicitResearchCommand,
    publicContextAllowanceValidator,
} from "@convex/domain/workbenchContracts";
import { requireMissionAuthority } from "@convex/execution/authority";
import {
    conversationInstructions,
    requireInstructionVersion,
} from "@convex/execution/conversations";
import { executionError } from "@convex/execution/errors";
import { missionScope } from "@convex/execution/missionData";
import { secSubmissionsUrl } from "@convex/integrations/sec";
import { requireCampaignLot } from "@convex/qualificationCampaigns";
import {
    DOCUMENTARY_SEARCH_QUERY_MAX_CHARS,
    SOURCES_ENVELOPE_MAX_COUNT,
} from "@convex/resourcePolicy";
import { readWorkbenchQualification } from "@convex/runWorkspace";
import { v } from "convex/values";
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
    if (
        !request?.missionId ||
        request.input.kind !== "verify_public_context" ||
        request.status !== "running" ||
        request.expectedGeneration !== expectedGeneration
    )
        throw executionError("request_unavailable");
    const { run, mission } = await requireMissionAuthority(
        ctx,
        request.missionId,
        expectedGeneration,
    );
    await requireInstructionVersion(ctx, mission, request.instructionVersion);
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
        request.pin?.kind !== "framing_revision" ||
        request.pin.revisionId !== run.currentFramingRevisionId
    )
        throw executionError("framing_version_conflict");
    const { messageId } = request.input;
    const instructions = await conversationInstructions(ctx, mission);
    if (
        !instructions?.messages.some(
            (message) =>
                message.messageId === messageId &&
                !explicitResearchCommand(message.text),
        ) ||
        instructions.messages.some((message) =>
            explicitFramingPreservation(message.text),
        )
    )
        throw executionError("instruction_not_authorized");
    const query = request.input.query.trim();
    if (!query || query.length > DOCUMENTARY_SEARCH_QUERY_MAX_CHARS)
        throw executionError("discovery_query_invalid");
    let allowance = run.publicContextAllowance;
    let qualificationDeadline: number | undefined;
    if (run.purpose === "browser_test") {
        const qualification = await readWorkbenchQualification(ctx, run);
        const binding = qualification?.scenarios?.find(
            ({ runId }) => runId === run._id,
        );
        const context = run.browserTestContextId
            ? await ctx.db.get(run.browserTestContextId)
            : null;
        if (!qualification || !binding || !context?.campaignLotId)
            throw executionError("paid_work_disabled");
        const { lot, campaign } = await requireCampaignLot(
            ctx,
            context.campaignLotId,
        );
        const scenario =
            campaign.manifest.version === 1
                ? undefined
                : campaign.manifest.scenarios.find(
                      ({ id }) => id === binding.id,
                  );
        if (!scenario?.framingPublicContext)
            throw executionError("paid_work_disabled");
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
    if (!allowance)
        throw executionError("public_context_allowance_unavailable");
    let suppliedReference: SuppliedReference | undefined;
    if (/^https?:\/\//iu.test(query)) {
        let url: URL;
        try {
            url = new URL(query);
        } catch {
            throw executionError("source_url_not_public");
        }
        if (
            url.protocol !== "https:" ||
            url.username ||
            url.password ||
            (url.port && url.port !== "443")
        )
            throw executionError("source_url_not_public");
        url.hash = "";
        const canonicalUrl = url.toString();
        const source = await ctx.db
            .query("sources")
            .withIndex("by_run_and_url", (q) =>
                q.eq("runId", run._id).eq("canonicalUrl", canonicalUrl),
            )
            .first();
        const original =
            instructions.messages.find(
                (message) => message.messageId === messageId,
            )?.text ?? "";
        const suppliedByAnalyst = original
            .match(/https:\/\/[^\s<>()[\]{}"']+/giu)
            ?.some((link) => {
                try {
                    const parsed = new URL(link.replace(/[.,;!?]+$/u, ""));
                    parsed.hash = "";
                    return parsed.toString() === canonicalUrl;
                } catch {
                    return false;
                }
            });
        if (!suppliedByAnalyst && source?.origin !== "analyst_url")
            throw executionError("source_reference_not_observed");
        const cleanCik = company.cik.replace(/^0+/u, "");
        const filing =
            /^\/Archives\/edgar\/data\/(\d+)\/(\d{18})\/[^/]+\.(?:htm|html|txt)$/u.exec(
                url.pathname,
            );
        const confirmedSec =
            url.hostname === "www.sec.gov" &&
            filing?.[1] === cleanCik &&
            filing[2] &&
            !url.search
                ? { cik: cleanCik, accession: filing[2] }
                : undefined;
        suppliedReference = {
            url: canonicalUrl,
            publishedAt: source?.publishedAt,
            confirmedSec,
        };
    }
    return {
        mission,
        run,
        allowance,
        qualificationDeadline,
        query: `${company.legalName}: ${query}`,
        suppliedReference,
    };
}

export const forExecution = internalQuery({
    args: {
        requestId: v.id("agentOperationRequests"),
        expectedGeneration: v.number(),
    },
    returns: v.object({
        missionId: v.id("agentMissions"),
        runId: v.id("researchRuns"),
        corpusRevisionId: v.optional(v.id("corpusRevisions")),
        workflowVersion: v.number(),
        deadlineAt: v.number(),
        query: v.string(),
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
            query,
            suppliedReference,
            qualificationDeadline,
        } = await requirePublicContextRequest(
            ctx,
            args.requestId,
            args.expectedGeneration,
        );
        return {
            missionId: mission._id,
            runId: run._id,
            corpusRevisionId: run.activeCorpusRevisionId,
            workflowVersion: mission.definitionVersion,
            deadlineAt: Math.min(
                mission.deadlineAt,
                qualificationDeadline ?? Infinity,
            ),
            query,
            ...(suppliedReference ? { suppliedReference } : {}),
        };
    },
});
