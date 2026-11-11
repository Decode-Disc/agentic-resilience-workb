import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { SourceReviewReads } from "@convex/domain/sourceReviewReads";
import {
    initializeSources,
    readSourcesMission,
    reconstructQualification,
    sourcesMissionKey,
} from "@convex/domain/sources";
import { materializeDocumentaryEvidence } from "@convex/domain/sourceUsage";
import {
    executionError,
    requireMissionAuthority,
    researchSlotBlock,
} from "@convex/execution/authority";
import { ensureDossierConversation } from "@convex/execution/conversations";
import {
    initialCampaignWorkbenchModel,
    requireLocalFixtureRun,
} from "@convex/execution/fixtures";
import { SOURCES_HANDOFF_READ_CAPACITY } from "@convex/resourcePolicy";
import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import {
    internalAction,
    internalMutation,
    type QueryCtx,
} from "./_generated/server";
import { requireCampaignLot } from "./qualificationCampaigns";
import {
    initialDocumentaryMaterial,
    initialFixtureContent,
} from "./qualificationInitialFixtures";
import {
    simulatedDocumentaryControl,
    sourcesQualificationEnvelope,
    sourcesSimulationEnabled,
} from "./sourcesSimulation";

const scopeArgs = {
    runId: v.id("researchRuns"),
    fixtureKey: v.string(),
    scenarioId: v.string(),
};
const scopeInput = v.object(scopeArgs);
const fixtureState = v.object({
    preparationId: v.id("sourceSelectionProposalRebuilds"),
    missionId: v.id("agentMissions"),
    captureId: v.id("sourceCaptures"),
    generation: v.number(),
    normalizerVersion: v.string(),
    sourceId: v.id("sources"),
});
type FixtureState = Infer<typeof fixtureState>;

async function requireInitialFixture(
    ctx: QueryCtx,
    args: Infer<typeof scopeInput>,
) {
    const scope = await requireLocalFixtureRun(ctx, args);
    const context = scope.run.browserTestContextId
        ? await ctx.db.get(scope.run.browserTestContextId)
        : null;
    if (!context?.campaignLotId)
        throw executionError("initial_fixture_not_authorized");
    const { campaign } = await requireCampaignLot(ctx, context.campaignLotId);
    if (
        campaign.manifest.version === 1 ||
        campaign.manifest.capability !== "sources"
    )
        throw executionError("initial_fixture_not_authorized");
    const scenario = campaign.manifest.scenarios.find(
        (entry) => entry.id === args.scenarioId,
    );
    const binding = (
        context.paidQualification?.scenarios ?? context.simulatedScenarios
    )?.find((entry) => entry.id === args.scenarioId);
    if (
        !scenario?.initialFixture ||
        binding?.runId !== scope.run._id ||
        scenario.initialFixture.hash !==
            sha256Hex(initialFixtureContent(scenario.initialFixture.id))
    )
        throw executionError("initial_fixture_not_authorized");
    return { ...scope, scenario, fixture: scenario.initialFixture };
}

/** Creates a fixture baseline, not a human research-start receipt or a provider-backed result. */
export const seed = internalMutation({
    args: scopeArgs,
    returns: fixtureState,
    handler: async (ctx, args): Promise<FixtureState> => {
        const { run, visitor, scenario, fixture } = await requireInitialFixture(
            ctx,
            args,
        );
        if (
            run.researchStartedAt !== undefined ||
            run.sourcePreparationId ||
            run.startMode === "framed" ||
            run.lifecycleState !== "framing" ||
            !run.activeCorpusRevisionId
        )
            throw executionError("initial_fixture_already_loaded");
        const slotBlock = await researchSlotBlock(ctx, visitor._id);
        if (slotBlock) throw executionError(slotBlock);
        const envelope = await sourcesQualificationEnvelope(ctx, run);
        if (!envelope) throw executionError("initial_fixture_not_authorized");
        const now = Date.now();
        const framingId = await ctx.db.insert("framingRevisions", {
            runId: run._id,
            revision: 1,
            content: scenario.framing,
            contentHash: sha256Hex(stableStringify(scenario.framing)),
            origin: "initial",
            requestKey: `fixture:${fixture.hash}`,
            createdAt: now,
        });
        await ctx.db.patch(run._id, {
            startMode: "framed",
            currentFramingRevisionId: framingId,
            fixedFramingRevisionId: framingId,
            researchStartedAt: now,
            researchStartRequestKey: `fixture:${fixture.hash}`,
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            pauseReason: undefined,
            sourcesProtocol: "sources_mission_v1",
            sourcesEnvelope: envelope,
            agentExecutionVersion: 3,
            nextEventSequence: run.nextEventSequence + 1,
        });
        await ctx.db.insert("runEvents", {
            runId: run._id,
            sequence: run.nextEventSequence + 1,
            type: "run_transitioned",
            lifecycleState: "discovering_sources",
            executionStatus: "running",
            occurredAt: now,
        });
        const current = await ctx.db.get(run._id);
        if (!current) throw executionError("run_unavailable");
        await ensureDossierConversation(
            ctx,
            { run: current, visitor },
            await initialCampaignWorkbenchModel(ctx, current),
        );
        const preparationId = await ctx.runMutation(
            internal.sourcePreparation.claimForDiscovery,
            {
                runId: run._id,
                corpusRevisionId: run.activeCorpusRevisionId,
                expectedExecutionGeneration: run.executionGeneration,
            },
        );
        const sourceId = await ctx.db.insert("sources", {
            runId: run._id,
            canonicalUrl: initialDocumentaryMaterial.url,
            title: initialDocumentaryMaterial.title,
            origin: "analyst_url",
            category: "illustrative_fixture",
            providerReference: `fixture:${fixture.hash}`,
            createdAt: now,
        });
        const reserved = await ctx.runMutation(
            internal.sourceCaptures.reserveUpload,
            { preparationId, sourceId },
        );
        if (!reserved.capture.normalizerVersion)
            throw executionError("capture_unavailable");
        const data = await initializeSources(ctx, preparationId, envelope);
        await ctx.db.patch(preparationId, {
            sourcesMission: {
                ...data,
                captureIds: [reserved.capture._id],
                needs: data.needs.map((need) =>
                    fixture.id === "sources_correction" && need.commonContext
                        ? {
                              ...need,
                              information: `${need.information} For this illustrative fixture, expand the existing contribution to state that no company facts are established, and add a separate contribution describing the capture/read sequence. Correct the observed contribution by its identity; preserve its independent material.`,
                          }
                        : need,
                ),
            },
        });
        const missionId = await ctx.runMutation(
            internal.execution.missions.start,
            {
                runId: run._id,
                expectedGeneration: run.executionGeneration,
                definitionId: "sources_v1",
                scope: { kind: "sources_v1", preparationId },
                requestKey: sourcesMissionKey(preparationId),
            },
        );
        return {
            preparationId,
            missionId,
            sourceId,
            captureId: reserved.capture._id,
            generation: run.executionGeneration,
            normalizerVersion: reserved.capture.normalizerVersion,
        };
    },
});

/** Imports a frozen fixture qualification; its showcase provenance never claims a fresh model control. */
export const retain = internalMutation({
    args: { ...scopeArgs, readRequestId: v.id("agentOperationRequests") },
    returns: v.null(),
    handler: async (ctx, args) => {
        const { run, fixture } = await requireInitialFixture(ctx, args);
        const preparation = run.sourcePreparationId
            ? await ctx.db.get(run.sourcePreparationId)
            : null;
        const mission = await readSourcesMission(ctx, run);
        const data = preparation?.sourcesMission;
        const read = await ctx.db.get(args.readRequestId);
        const capture = data?.captureIds[0]
            ? await ctx.db.get(data.captureIds[0])
            : null;
        if (
            !preparation ||
            !data ||
            !mission ||
            !capture?.contentHash ||
            !run.activeCorpusRevisionId ||
            read?.missionId !== mission._id ||
            read.runId !== run._id ||
            data.qualifications.length
        )
            throw executionError("initial_fixture_identity_conflict");
        await requireMissionAuthority(
            ctx,
            mission._id,
            read.expectedGeneration,
        );
        const reads = new SourceReviewReads(
            ctx.db,
            run._id,
            SOURCES_HANDOFF_READ_CAPACITY,
        );
        const evidence = await materializeDocumentaryEvidence(
            reads,
            read,
            data,
            [{ readRequestId: read._id, passageOrder: 0 }],
        );
        const contributions = reconstructQualification(
            {
                sourceId: capture.sourceId,
                captureId: capture._id,
                expectedTaskId: null,
                changes: [
                    {
                        contribution: {
                            needIds: data.needs.map((need) => need.id),
                            statement: initialDocumentaryMaterial.statement,
                            period: "Retained illustrative fixture",
                            attribution: initialDocumentaryMaterial.title,
                            modality: "Illustrative description",
                            kind: "context",
                            evidence,
                        },
                    },
                ],
            },
            null,
            data,
            `fixture:${run._id}:${fixture.hash}`,
        );
        const base = {
            runId: run._id,
            corpusRevisionId: run.activeCorpusRevisionId,
            sourceId: capture.sourceId,
            sourceCaptureId: capture._id,
            executionMode: "showcase" as const,
            fixtureId: fixture.id,
            fixtureVersion: fixture.hash,
            adapterVersion: "retained-documentary-fixture-v1",
            inputHash: fixture.hash,
            createdAt: Date.now(),
        };
        const controlTaskId = await ctx.db.insert("aiTaskResults", {
            ...base,
            taskType: "documentary_control",
            schemaVersion: "documentary-control-v1",
            output: {
                kind: "documentary_control",
                preparationId: preparation._id,
                evidence,
                inputHash: fixture.hash,
                control: simulatedDocumentaryControl(contributions),
            },
        });
        const taskId = await ctx.db.insert("aiTaskResults", {
            ...base,
            taskType: "documentary_qualification",
            schemaVersion: "documentary-qualification-v1",
            output: {
                kind: "documentary_qualification",
                preparationId: preparation._id,
                captureId: capture._id,
                contentHash: capture.contentHash,
                version: 1,
                contributions,
                controlTaskId,
            },
        });
        await ctx.db.patch(preparation._id, {
            sourcesMission: { ...data, qualifications: [taskId] },
        });
        return null;
    },
});

/** Storage, indexing and reading use production owners; fixture reconstruction performs no provider call. */
export const install = internalAction({
    args: scopeArgs,
    returns: fixtureState.pick("preparationId", "missionId", "captureId"),
    handler: async (
        ctx,
        args,
    ): Promise<
        Pick<FixtureState, "preparationId" | "missionId" | "captureId">
    > => {
        const state = await ctx.runMutation(
            internal.qualificationInitialFixtureSetup.seed,
            args,
        );
        const text = initialDocumentaryMaterial.text;
        const storageId = await ctx.storage.store(
            new Blob([text], { type: "text/plain; charset=utf-8" }),
        );
        await ctx.runMutation(internal.sourceCaptures.attachStorage, {
            preparationId: state.preparationId,
            captureId: state.captureId,
            storageId,
        });
        await ctx.runMutation(internal.sourceCaptures.finalize, {
            preparationId: state.preparationId,
            captureId: state.captureId,
            contentHash: sha256Hex(text),
            byteCount: new TextEncoder().encode(text).length,
            resolvedUrl: initialDocumentaryMaterial.url,
            retrievalVersion: "retained-documentary-fixture-v1",
            normalizerVersion: state.normalizerVersion,
            retrievedAt: Date.now(),
            readingCompleteness: "complete",
            representationCompleteness: "complete",
            omittedPassageCount: 0,
        });
        await ctx.runAction(internal.sourceRetrievalActions.indexCapture, {
            preparationId: state.preparationId,
            captureId: state.captureId,
            mode: "lexical",
            allowProviderCalls: false,
        });
        const readRequestId = await ctx.runMutation(
            internal.execution.operations.enqueue,
            {
                missionId: state.missionId,
                expectedGeneration: state.generation,
                cause: "initial-fixture-read",
                input: {
                    kind: "search_available_material",
                    sourceId: state.sourceId,
                    query: "documentary workflow",
                },
            },
        );
        const outcome = await ctx.runAction(
            internal.execution.operations.dispatch,
            { requestId: readRequestId, expectedGeneration: state.generation },
        );
        if (outcome.kind !== "success")
            throw executionError("initial_fixture_read_unavailable");
        await ctx.runMutation(
            internal.qualificationInitialFixtureSetup.retain,
            { ...args, readRequestId },
        );
        await ctx.runMutation(
            internal.qualificationInitialFixtureSetup.settle,
            { ...args, readRequestId },
        );
        return {
            preparationId: state.preparationId,
            missionId: state.missionId,
            captureId: state.captureId,
        };
    },
});

export const settle = internalMutation({
    args: { ...scopeArgs, readRequestId: v.id("agentOperationRequests") },
    returns: v.null(),
    handler: async (ctx, args) => {
        const { run, fixture } = await requireInitialFixture(ctx, args);
        if (fixture.id === "sources_correction") return null;
        const mission = await readSourcesMission(ctx, run);
        const preparation = run.sourcePreparationId
            ? await ctx.db.get(run.sourcePreparationId)
            : null;
        if (!mission || !preparation?.sourcesMission)
            throw executionError("initial_fixture_identity_conflict");
        const begun = await ctx.runMutation(
            internal.execution.invocations.begin,
            {
                missionId: mission._id,
                expectedGeneration: run.executionGeneration,
                taskKey: `fixture:${fixture.id}`,
                provenance: "simulation",
            },
        );
        if (begun.kind !== "ready") throw executionError(begun.code);
        await ctx.runMutation(internal.execution.invocations.finish, {
            invocationId: begun.invocationId,
            expectedGeneration: run.executionGeneration,
            response:
                fixture.id === "sources_interrupted_partial"
                    ? { kind: "blocked", code: "initial_fixture_interrupted" }
                    : {
                          kind: "complete",
                          needs: preparation.sourcesMission.needs.map(
                              (need) => ({
                                  needId: need.id,
                                  gap: initialDocumentaryMaterial.gap,
                                  unfinished: [
                                      initialDocumentaryMaterial.unfinished,
                                  ],
                                  readRequestIds: [args.readRequestId],
                              }),
                          ),
                      },
        });
        await ctx.runMutation(internal.sourcesMission.finish, {
            preparationId: preparation._id,
            missionId: mission._id,
            expectedGeneration: run.executionGeneration,
        });
        return null;
    },
});

/** Starts only the declared warm Sources fixture through the existing executor. */
export const activate = internalMutation({
    args: scopeArgs,
    returns: v.null(),
    handler: async (ctx, args) => {
        const { run, fixture } = await requireInitialFixture(ctx, args);
        if (fixture.id !== "sources_correction") return null;
        const mission = await readSourcesMission(ctx, run);
        if (mission?.status !== "ready")
            throw executionError("initial_fixture_already_active");
        await ctx.runMutation(internal.execution.missions.resume, {
            missionId: mission._id,
            expectedGeneration: run.executionGeneration,
            simulation: await sourcesSimulationEnabled(ctx, run._id),
        });
        return null;
    },
});

/** A fixture starting at the mission boundary uses the existing handoff after its native execution settles. */
export const finish = internalMutation({
    args: scopeArgs,
    returns: v.null(),
    handler: async (ctx, args) => {
        const { run, fixture } = await requireInitialFixture(ctx, args);
        if (
            fixture.id !== "sources_correction" ||
            run.lifecycleState === "sources_prepared"
        )
            return null;
        const mission = await readSourcesMission(ctx, run);
        if (
            !mission ||
            !run.sourcePreparationId ||
            !["completed", "blocked"].includes(mission.status)
        )
            return null;
        await ctx.runMutation(internal.sourcesMission.finish, {
            preparationId: run.sourcePreparationId,
            missionId: mission._id,
            expectedGeneration: run.executionGeneration,
        });
        return null;
    },
});
