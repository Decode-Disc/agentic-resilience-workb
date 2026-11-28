import { MAX_MODEL_OPERATION_OUTPUT_BYTES } from "@convex/execution/agentDefinition";
import type { AgentOperationDefinition } from "@convex/execution/executionProtocol";
import { type TranscriptContext, Type } from "@earendil-works/pi-ai";
import { estimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import { asSchema } from "ai";
import { agentOperationInputSchema, piInstructionSection } from "./modelInput";

/** Native execution and offline calibration use the same tool metadata. */
export async function piToolMetadata(
    name: string,
    operation: Pick<AgentOperationDefinition, "description" | "inputValidator">,
) {
    return {
        name,
        description: operation.description,
        replay: "safe" as const,
        executionMode: "sequential" as const,
        outputLimits: {
            maxBytes: MAX_MODEL_OPERATION_OUTPUT_BYTES,
        },
        parameters: Type.Unsafe<Record<string, unknown>>(
            await asSchema(agentOperationInputSchema(operation)).jsonSchema,
        ),
    };
}

/** Uses Pi's estimator for the non-lossy section, actual declarations and an optional initial analyst lot. */
export function piRequiredContextTokens(
    instructions: string,
    state: string,
    tools: NonNullable<
        Extract<
            TranscriptContext["messages"][number],
            { role: "system" }
        >["toolsAdded"]
    >,
    initialInput?: string,
) {
    return estimateContextTokens([
        {
            role: "system",
            content: piInstructionSection(instructions),
            toolsAdded: tools,
            timestamp: 0,
        },
        { role: "system", content: state, timestamp: 0 },
        ...(initialInput
            ? [{ role: "user" as const, content: initialInput, timestamp: 0 }]
            : []),
    ]).tokens;
}
