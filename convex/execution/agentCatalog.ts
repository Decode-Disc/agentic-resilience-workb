import type { Doc } from "@convex/_generated/dataModel";
import { conversationValidationDefinition } from "@convex/domain/conversationValidation";
import { executionValidationDefinition } from "@convex/domain/executionValidationAgent";
import {
    documentaryInspectionDefinition,
    savedMaterialInspectionDefinition,
} from "@convex/domain/savedMaterialInspection";
import {
    sourcesMethodControlDefinition,
    sourcesV4Definition,
    sourcesV5Definition,
    sourcesV7Definition,
} from "@convex/domain/sourcesAgent";
import {
    directedWorkbenchDefinition,
    workbenchDefinition,
    workbenchMethodControlDefinition,
    workbenchV6Definition,
    workbenchV7Definition,
    workbenchV9Definition,
    workbenchV10Definition,
    workbenchV11Definition,
    workbenchV12Definition,
} from "@convex/domain/workbenchAgent";
import { getFunctionName } from "convex/server";
import {
    type AgentDefinition,
    agentMethodInstructions,
    separatedContextInstructions,
} from "./agentDefinition";
import { readSkillOperation, skillCatalogue } from "./agentSkills";
import { commonOperations } from "./commonOperations";
import { executionError } from "./errors";
import type { AgentOperationDefinition } from "./executionProtocol";
import { operationResultSchema } from "./operationResults";

// Defer imported definition reads until module initialization has completed.
function definitions() {
    return {
        [sourcesV7Definition.id]: sourcesV7Definition,
        [workbenchV12Definition.id]: workbenchV12Definition,
        [conversationValidationDefinition.id]: conversationValidationDefinition,
        [executionValidationDefinition.id]: executionValidationDefinition,
        [documentaryInspectionDefinition.id]: documentaryInspectionDefinition,
    } satisfies Record<Doc<"agentMissions">["definitionId"], AgentDefinition>;
}

/** Reject incomplete or contradictory declarations before any callback is dispatched. */
export function assertOperationContract(
    name: string,
    operation: AgentOperationDefinition,
): void {
    if (
        !name ||
        !["read", "atomic_effect", "durable_effect", "delegation"].includes(
            operation.effectKind,
        ) ||
        (operation.scheduledAction !== undefined
            ? operation.effectKind !== "durable_effect" ||
              operation.execute !== undefined
            : typeof operation.execute !== "function") ||
        typeof operation.resultValidator?.safeParse !== "function" ||
        typeof operation.pin !== "function" ||
        typeof operation.identity !== "function" ||
        typeof operation.validateOutcome !== "function" ||
        !Number.isSafeInteger(operation.version) ||
        operation.version < 1 ||
        (operation.effectKind === "delegation") !==
            (typeof operation.childMission === "function")
    )
        throw executionError("operation_contract_invalid");
    if (operation.scheduledAction !== undefined) {
        try {
            getFunctionName(operation.scheduledAction);
        } catch {
            throw executionError("operation_contract_invalid");
        }
    }
    if (!closedResultObject(operationResultSchema(operation.resultValidator)))
        throw executionError("operation_contract_invalid");
}

function closedResultObject(schema: object): boolean {
    const value = schema as {
        type?: unknown;
        additionalProperties?: unknown;
        anyOf?: object[];
    };
    return value.anyOf
        ? value.anyOf.length > 0 && value.anyOf.every(closedResultObject)
        : value.type === "object" && value.additionalProperties === false;
}

/** Skill adoption is composed after all raw definitions have initialized. */
function definitionOperations(definition: AgentDefinition) {
    return definition.skills
        ? { ...definition.operations, read: readSkillOperation }
        : definition.operations;
}

/** Apply the same closed contract when validating or resolving a registered definition. */
export function bindAgentDefinition(
    definition: AgentDefinition,
): AgentDefinition {
    if (
        (definition.nativeConversation &&
            definition.executionScope !== "conversation") ||
        (definition.executionScope === "conversation" &&
            !definition.conversationReply)
    )
        throw executionError("definition_contract_invalid");
    const admittedOperations = definitionOperations(definition);
    for (const [name, operation] of Object.entries(admittedOperations)) {
        assertOperationContract(name, operation);
        if (name in commonOperations)
            throw executionError("operation_definition_conflict");
    }
    for (const [name, operation] of Object.entries(commonOperations))
        assertOperationContract(name, operation);
    return {
        ...definition,
        instructions: [
            agentMethodInstructions,
            ...(definition.contextRendering === "separated_v1"
                ? [separatedContextInstructions]
                : []),
            definition.instructions,
            ...(definition.skills && definition.skills.catalogue !== false
                ? [skillCatalogue(definition.skills)]
                : []),
        ].join("\n"),
        compactionInstructions: [
            "Preserve current objectives, active instructions, unresolved corrections and exact observation references. Distinguish authoritative state from historical proposals and untrusted evidence.",
            definition.compactionInstructions ?? "",
        ]
            .filter(Boolean)
            .join("\n"),
        operations: { ...admittedOperations, ...commonOperations },
    };
}

function supportedDefinitions(): readonly AgentDefinition[] {
    return [
        ...Object.values(definitions()),
        workbenchDefinition,
        directedWorkbenchDefinition,
        workbenchV6Definition,
        workbenchV7Definition,
        workbenchV9Definition,
        workbenchV10Definition,
        workbenchV11Definition,
        sourcesV4Definition,
        sourcesV5Definition,
        savedMaterialInspectionDefinition,
        workbenchMethodControlDefinition,
        sourcesMethodControlDefinition,
    ];
}

/** Enumerates the exact versioned bindings accepted by runtime resolution. */
export function registeredAgentDefinitions(): readonly AgentDefinition[] {
    return supportedDefinitions().map(bindAgentDefinition);
}

let nativeOperations: Map<string, AgentOperationDefinition> | undefined;

function registeredNativeOperations() {
    if (nativeOperations) return nativeOperations;
    const entries = new Map<string, AgentOperationDefinition>();
    const declarations = [
        ...Object.entries(commonOperations),
        ...supportedDefinitions().flatMap((definition) =>
            Object.entries(definitionOperations(definition)),
        ),
    ];
    for (const [name, operation] of declarations) {
        if (!operation.nativeAuthority) continue;
        assertOperationContract(name, operation);
        const existing = entries.get(name);
        if (existing && existing !== operation)
            throw executionError("operation_definition_conflict");
        entries.set(name, operation);
    }
    nativeOperations = entries;
    return entries;
}

/** Only missionless operations use the native catalogue. Missions resolve their pinned definition. */
export function getNativeOperation(name: string) {
    return registeredNativeOperations().get(name);
}

/** Resolves the static domain binding; routing and execution mechanics remain separate owners. */
export function getAgentDefinition(
    id: Doc<"agentMissions">["definitionId"],
    version?: number,
): AgentDefinition {
    const current = definitions();
    const selectedVersion = version ?? current[id].version;
    const definition = supportedDefinitions().find(
        (definition) =>
            definition.id === id && definition.version === selectedVersion,
    );
    if (!definition) throw executionError("definition_version_conflict");
    return bindAgentDefinition(definition);
}
