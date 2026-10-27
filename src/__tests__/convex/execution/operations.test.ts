import { savedMaterialOperationValidator } from "@convex/domain/savedMaterialOperations";
import { convexToZod } from "convex-helpers/server/zod";
import { expect, test } from "vitest";

const operationSchema = convexToZod(savedMaterialOperationValidator);

test("accepts only the canonical saved-material operation inputs", () => {
    const operations = [
        { kind: "consult_mission_state" },
        { kind: "consult_mission_state", cursor: "history-cursor" },
        {
            kind: "search_available_material",
            sourceId: "sources:approved",
            query: "pricing pressure",
        },
        {
            kind: "read_in_context",
            sourceId: "sources:approved",
            passageOrder: 12,
        },
    ];

    expect(
        operations.map((operation) => operationSchema.parse(operation)),
    ).toEqual(operations);
    expect(
        operationSchema.safeParse({
            kind: "search_available_material",
            sourceId: "sources:approved",
        }).success,
    ).toBe(false);
    expect(
        operationSchema.safeParse({ kind: "invented_operation" }).success,
    ).toBe(false);
});
