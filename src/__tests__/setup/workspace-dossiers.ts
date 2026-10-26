import { api } from "@convex/_generated/api";
import { vi } from "vitest";
import { convexReactHarness } from "@/__tests__/helpers/convex-react-harness";

/** Subscription snapshots for the server-scoped dossier pager. */
export function mockDossierList() {
    const query = convexReactHarness.paginatedQuery(api.researchRuns.listMine);
    return {
        returns(results: unknown) {
            query.returns({
                results: results ?? [],
                status:
                    results === undefined ? "LoadingFirstPage" : "Exhausted",
                loadMore: vi.fn(),
            });
            return this;
        },
        throws(error: Error) {
            query.throws(error);
            return this;
        },
    };
}

export function mockResearchWorkspace() {
    convexReactHarness.query(api.visitors.current).returns({
        workspace: {
            key: "research:visitor",
            isTestData: false,
            canStartDossier: true,
        },
    });
}
