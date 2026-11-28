import { internal } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import {
    requireBrowserFixtureContext,
    requireBrowserTestRunOwner,
} from "@convex/domain/browserFixtureAccess";
import { requireFixtureScope } from "@convex/domain/conversationFixtureAuthority";
import { conversationValidationSchemas } from "@convex/domain/conversationValidationContracts";
import { validationSchemas } from "@convex/domain/executionValidationContracts";
import {
    WORKBENCH_FRAMING_RECEIPT_VERSION,
    WORKBENCH_SCOPED_DOCUMENTARY_VERSION,
} from "@convex/domain/framingContracts";
import { requireSavedMaterialScope } from "@convex/domain/savedMaterialAuthority";
import {
    REFERENCED_INSPECTION_VERSION,
    REFERENCED_SOURCES_VERSION,
    SAVED_MATERIAL_DEFINITION_VERSION,
    SCOPED_DOCUMENTARY_INSPECTION_VERSION,
    SCOPED_DOCUMENTARY_SOURCES_VERSION,
    savedMaterialScopeValidator,
    savedMaterialStateValidator,
    WORKBENCH_DOCUMENTARY_DEFINITION_VERSION,
} from "@convex/domain/savedMaterialScope";
import { requireSourcesPreparation } from "@convex/domain/sourcesAuthority";
import {
    sourcesScopeValidator,
    sourcesStateValidator,
} from "@convex/domain/sourcesScope";
import {
    workbenchScopeValidator,
    workbenchStateValidator,
} from "@convex/domain/workbenchScope";
import type { AgentDefinition } from "./agentDefinition";
import { executionError } from "./errors";

type Authority = Pick<
    AgentDefinition,
    | "executionScope"
    | "nativeConversation"
    | "completionTransport"
    | "scopeValidator"
    | "stateValidator"
    | "requireAuthority"
> & { hasConversationReply: boolean };

const workbench = {
    executionScope: "conversation",
    nativeConversation: true,
    hasConversationReply: true,
    scopeValidator: workbenchScopeValidator,
    stateValidator: workbenchStateValidator,
    async requireAuthority(_ctx, _mission, run) {
        if (run.startMode !== "framed")
            throw executionError("workbench_not_available");
    },
} satisfies Authority;

const sources = {
    executionScope: "research",
    hasConversationReply: false,
    scopeValidator: sourcesScopeValidator,
    stateValidator: sourcesStateValidator,
    async requireAuthority(ctx, mission) {
        if (!("scope" in mission) || mission.scope.kind !== "sources_v1")
            throw executionError("sources_scope_invalid");
        if (mission.provenance === "simulation")
            await ctx.runQuery(internal.sourcesSimulation.enabled, {
                runId: mission.runId,
            });
        const { run } = await requireSourcesPreparation(
            ctx,
            mission.scope.preparationId,
            "observation",
        );
        if (run._id !== mission.runId)
            throw executionError("sources_scope_invalid");
    },
} satisfies Authority;

const savedMaterial: Authority = {
    executionScope: "research",
    hasConversationReply: false,
    scopeValidator: savedMaterialScopeValidator,
    stateValidator: savedMaterialStateValidator,
    async requireAuthority(ctx, mission, run) {
        await requireSavedMaterialScope(ctx, mission, run);
    },
};

const conversationValidation: Authority = {
    executionScope: "conversation",
    hasConversationReply: true,
    scopeValidator: conversationValidationSchemas.scope,
    stateValidator: conversationValidationSchemas.state,
    async requireAuthority(ctx, _mission, run) {
        await requireFixtureScope(ctx, run._id);
    },
};

const executionValidation: Authority = {
    executionScope: "research",
    hasConversationReply: false,
    scopeValidator: validationSchemas.scope,
    stateValidator: validationSchemas.state,
    async requireAuthority(ctx, mission, run) {
        const visitor = await requireBrowserTestRunOwner(ctx, run);
        const contextId = await requireBrowserFixtureContext(ctx, visitor);
        if (
            run.purpose !== "browser_test" ||
            mission.ownerVisitorId !== visitor._id ||
            run.browserTestContextId !== contextId
        )
            throw executionError("simulation_not_authorized");
    },
};

export function retainedMethodVersion(
    definitionId: "workbench_v1" | "sources_v1",
) {
    return definitionId === "workbench_v1" ? 8 : 6;
}

function retainedMethod(base: Authority): Authority {
    return {
        ...base,
        async requireAuthority(ctx, mission, run) {
            await ctx.runQuery(
                internal.qualificationAgentMethods.requireRetainedAuthority,
                { missionId: mission._id },
            );
            await base.requireAuthority(ctx, mission, run);
        },
    };
}

const currentVersions = {
    workbench_v1: WORKBENCH_SCOPED_DOCUMENTARY_VERSION,
    sources_v1: SCOPED_DOCUMENTARY_SOURCES_VERSION,
    saved_material_inspection_v1: SCOPED_DOCUMENTARY_INSPECTION_VERSION,
    conversation_validation_v1: 3,
    execution_validation_v1: 3,
} as const;

const bindings: Record<
    keyof typeof currentVersions,
    Readonly<Partial<Record<number, Authority>>>
> = {
    workbench_v1: {
        4: workbench,
        5: workbench,
        6: workbench,
        7: workbench,
        [retainedMethodVersion("workbench_v1")]: retainedMethod(workbench),
        9: workbench,
        [WORKBENCH_DOCUMENTARY_DEFINITION_VERSION]: workbench,
        [WORKBENCH_FRAMING_RECEIPT_VERSION]: workbench,
        [WORKBENCH_SCOPED_DOCUMENTARY_VERSION]: workbench,
    },
    sources_v1: {
        4: sources,
        5: sources,
        [retainedMethodVersion("sources_v1")]: retainedMethod(sources),
        [REFERENCED_SOURCES_VERSION]: sources,
        [SCOPED_DOCUMENTARY_SOURCES_VERSION]: {
            ...sources,
            completionTransport: "native_tool",
        },
    },
    saved_material_inspection_v1: {
        [SAVED_MATERIAL_DEFINITION_VERSION]: savedMaterial,
        [REFERENCED_INSPECTION_VERSION]: savedMaterial,
        [SCOPED_DOCUMENTARY_INSPECTION_VERSION]: {
            ...savedMaterial,
            completionTransport: "native_tool",
        },
    },
    conversation_validation_v1: {
        2: conversationValidation,
        3: { ...conversationValidation, completionTransport: "native_tool" },
    },
    execution_validation_v1: {
        2: executionValidation,
        3: { ...executionValidation, completionTransport: "native_tool" },
    },
};

export function getAgentAuthority(
    id: Doc<"agentMissions">["definitionId"],
    version: number = currentVersions[id],
) {
    const authority = bindings[id]?.[version];
    if (!authority) throw executionError("definition_version_conflict");
    return { id, ...authority };
}
