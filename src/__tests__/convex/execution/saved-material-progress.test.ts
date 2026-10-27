import { internal } from "@convex/_generated/api";
import { afterEach, expect, test, vi } from "vitest";
import { seedInspectedEvidence } from "@/__tests__/setup/source-preparation";

afterEach(() => vi.unstubAllGlobals());

test("overlapping search results count each inspected passage only once", async () => {
    const text = [
        "# Recurring fees",
        "Subscription pricing includes recurring fees.",
        "# Annual cycles",
        "Subscription pricing follows annual cycles.",
    ].join("\n\n");
    const { t, args, sourceId } = await seedInspectedEvidence({ text });
    vi.stubGlobal(
        "fetch",
        vi.fn(() => {
            throw new Error("Unexpected external I/O");
        }),
    );
    const missionId = await t.mutation(internal.execution.missions.start, {
        runId: args.runId,
        corpusRevisionId: args.corpusRevisionId,
        definitionId: "saved_material_inspection_v1",
        requestKey: "overlapping-search-progress",
        expectedGeneration: 4,
    });

    const searchResults: string[][] = [];
    for (const [index, query] of [
        "subscription",
        "recurring",
        "annual",
    ].entries()) {
        const requestId = await t.mutation(
            internal.execution.operations.enqueue,
            {
                missionId,
                expectedGeneration: 4,
                cause: `search-${index}`,
                input: { kind: "search_available_material", sourceId, query },
            },
        );
        const outcome = await t.action(internal.execution.operations.dispatch, {
            requestId,
            expectedGeneration: 4,
        });
        expect(outcome.kind).toBe("success");
        if (outcome.kind === "success") {
            searchResults.push(
                JSON.parse(outcome.valueJson).passages.map(
                    (passage: { exactQuote: string }) => passage.exactQuote,
                ),
            );
        }
    }

    expect(searchResults.map((quotes) => quotes.length)).toEqual([2, 1, 1]);
    const mission = await t.run((ctx) => ctx.db.get(missionId));
    expect(mission?.progressKeys).toHaveLength(2);
});
