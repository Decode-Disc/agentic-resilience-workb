import {
    type AgentDefinition,
    domainSnapshot,
} from "@convex/execution/agentDefinition";
import { z } from "zod";

const snapshot = z.object({
    activeWork: z.object({
        needs: z.array(z.object({ id: z.string() })).min(1),
        candidates: z.array(
            z.object({
                sourceId: z.string(),
                acquisitionReference: z.string().optional(),
            }),
        ),
        captures: z
            .array(
                z.object({
                    captureId: z.string().optional(),
                    sourceId: z.string().optional(),
                    readingReferences: z.array(
                        z.object({ reference: z.string() }),
                    ),
                }),
            )
            .optional(),
        readingReferences: z
            .array(
                z.object({
                    readRequestId: z.string(),
                    passageOrders: z.array(z.number()),
                }),
            )
            .optional(),
    }),
    triggeringRequestsAndResults: z.array(
        z.object({
            requestId: z.string(),
            input: z.object({ kind: z.string() }),
            outcome: z
                .object({ kind: z.string(), captureId: z.string().optional() })
                .nullable(),
        }),
    ),
});
/** Fixed replies drive real operations; they never assert success or fabricate evidence identities. */
export const sourcesSimulation: NonNullable<AgentDefinition["simulate"]> = (
    input,
) => {
    const parsed = snapshot.safeParse(domainSnapshot(input));
    if (!parsed.success)
        return { kind: "blocked", code: "simulation_context_invalid" };
    const { activeWork, triggeringRequestsAndResults: requests } = parsed.data;
    const latest = requests.at(-1);
    if (latest && latest.outcome?.kind !== "success")
        return { kind: "blocked", code: "simulation_operation_failed" };
    const need = activeWork.needs[0];
    if (!need) return { kind: "blocked", code: "simulation_context_invalid" };
    const needId = need.id;
    const request = (name: string, value: unknown) => ({
        kind: "operations" as const,
        requests: [
            {
                callId: `simulated-${name}`,
                name,
                inputJson: JSON.stringify(value),
            },
        ],
        workingNotes:
            "Simulation only: exercise documentary execution; no company facts established.",
    });
    if (!latest)
        return request("discover_sources_for_need", {
            needId,
            query: "simulation documentary workflow",
        });
    const source = activeWork.candidates[0];
    if (!source)
        return { kind: "blocked", code: "simulation_material_unavailable" };
    if (latest.input.kind === "discover_sources_for_need")
        return source.acquisitionReference
            ? request("acquire_document", {
                  reference: source.acquisitionReference,
              })
            : request("make_source_consultable", {
                  needId,
                  sourceId: source.sourceId,
              });
    if (latest.input.kind === "make_source_consultable")
        return request("search_available_material", {
            sourceId: source.sourceId,
            query: "workflow",
        });
    if (latest.input.kind === "acquire_document") {
        const capture = activeWork.captures?.find(
            (c) => c.captureId === latest.outcome?.captureId,
        );
        const reference = capture?.readingReferences[0]?.reference;
        return reference
            ? request("search_available_material", {
                  reference,
                  query: "workflow",
              })
            : { kind: "blocked", code: "simulation_material_unavailable" };
    }
    if (
        latest.input.kind === "search_available_material" &&
        !source.acquisitionReference
    )
        return request("read_in_context", {
            sourceId: source.sourceId,
            passageOrder: 0,
        });
    if (
        (latest.input.kind === "read_in_context" ||
            (source.acquisitionReference &&
                latest.input.kind === "search_available_material")) &&
        latest.outcome?.captureId
    ) {
        const passageOrder = source.acquisitionReference
            ? activeWork.readingReferences?.find(
                  (read) => read.readRequestId === latest.requestId,
              )?.passageOrders[0]
            : 0;
        if (passageOrder === undefined)
            return { kind: "blocked", code: "simulation_material_unavailable" };
        return request("submit_documentary_qualification", {
            sourceId: source.sourceId,
            captureId: latest.outcome.captureId,
            changes: [
                {
                    contribution: {
                        needIds: [needId],
                        statement:
                            "This simulated document describes a documentary workflow.",
                        period: "Simulation fixture",
                        modality: "Illustrative description",
                        attribution: "Simulation fixture; not live",
                        kind: "context",
                        evidence: [
                            {
                                readRequestId: latest.requestId,
                                passageOrder,
                            },
                        ],
                    },
                },
            ],
        });
    }
    if (latest.input.kind === "submit_documentary_qualification")
        return {
            kind: "complete",
            needs: activeWork.needs.map((need) => ({
                needId: need.id,
                unfinished: [
                    "Simulation only; real documentary needs remain unqualified.",
                ],
            })),
            workingNotes:
                "Simulation completed; no live evidence or model quality established.",
        };
    return { kind: "blocked", code: "simulation_step_unavailable" };
};
