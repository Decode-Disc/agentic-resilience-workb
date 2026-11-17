import { makeFunctionReference } from "convex/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { convexReactHarness } from "@/__tests__/helpers/convex-react-harness";

const currentVisitor = makeFunctionReference<
    "query",
    Record<string, never>,
    { role: "analyst" } | null
>("visitors:current");
const listSources = makeFunctionReference<
    "query",
    { disposition: "recommended" | "alternative" },
    Array<{ title: string }>
>("sources:list");
const listSourcesPage = makeFunctionReference<
    "query",
    {
        disposition: "recommended" | "alternative";
        paginationOpts: { numItems: number; cursor: string | null };
    },
    { page: Array<{ title: string }> }
>("sources:listPage");
const decideSource = makeFunctionReference<
    "mutation",
    { sourceId: string; decision: "accepted" | "rejected" },
    { accepted: boolean }
>("sources:decide");
const rebuildSources = makeFunctionReference<
    "action",
    { runId: string },
    { outcome: "complete" }
>("sources:rebuild");

describe("convexReactHarness", () => {
    beforeEach(() => {
        convexReactHarness.reset();
    });

    test("keeps configured query snapshots stable", () => {
        const visitor = { role: "analyst" } as const;
        convexReactHarness.query(currentVisitor).returns(visitor);

        const first = convexReactHarness.module.useQuery(currentVisitor, {});
        const second = convexReactHarness.module.useQuery(currentVisitor, {});

        expect(first).toBe(visitor);
        expect(second).toBe(first);
    });

    test("routes query values by function reference and arguments", () => {
        const recommended = [{ title: "Annual report" }];
        const alternative = [{ title: "Industry analysis" }];
        convexReactHarness
            .query(listSources)
            .returnsFrom(({ args }) =>
                args !== "skip" && args.disposition === "recommended"
                    ? recommended
                    : alternative,
            );

        expect(
            convexReactHarness.module.useQuery(listSources, {
                disposition: "recommended",
            }),
        ).toBe(recommended);
        expect(
            convexReactHarness.module.useQuery(listSources, {
                disposition: "alternative",
            }),
        ).toBe(alternative);
        expect(convexReactHarness.module.useQuery(listSources, "skip")).toBe(
            undefined,
        );
    });

    test("routes paginated snapshots with hook options", () => {
        const page = {
            results: [{ title: "Annual report" }],
            status: "Exhausted",
            loadMore: vi.fn(),
        };
        convexReactHarness
            .paginatedQuery(listSourcesPage)
            .returnsFrom(({ args, options }) => {
                expect(args).toEqual({ disposition: "recommended" });
                expect(options).toEqual({ initialNumItems: 12 });
                return page;
            });

        expect(
            convexReactHarness.module.usePaginatedQuery(
                listSourcesPage,
                { disposition: "recommended" },
                { initialNumItems: 12 },
            ),
        ).toBe(page);
    });

    test("returns configured paginated controls when a query is skipped", () => {
        const skippedPage = {
            results: [],
            status: "LoadingFirstPage",
            loadMore: vi.fn(),
        };
        convexReactHarness.paginatedQuery(listSourcesPage).returns(skippedPage);

        expect(
            convexReactHarness.module.usePaginatedQuery(
                listSourcesPage,
                "skip",
                { initialNumItems: 12 },
            ),
        ).toBe(skippedPage);
    });

    test("returns configured mutation and action spies", async () => {
        const decide = vi.fn().mockResolvedValue({ accepted: true });
        const rebuild = vi.fn().mockResolvedValue({ outcome: "complete" });
        convexReactHarness.mutation(decideSource).uses(decide);
        convexReactHarness.action(rebuildSources).uses(rebuild);

        const mutation = convexReactHarness.module.useMutation(decideSource);
        const action = convexReactHarness.module.useAction(rebuildSources);

        await expect(
            mutation({ sourceId: "source-1", decision: "accepted" }),
        ).resolves.toEqual({ accepted: true });
        await expect(action({ runId: "run-1" })).resolves.toEqual({
            outcome: "complete",
        });
    });

    test("clears configured behavior between tests", () => {
        expect(() =>
            convexReactHarness.module.useQuery(currentVisitor, {}),
        ).toThrow("No Convex query mock configured for visitors:current");
    });
});
