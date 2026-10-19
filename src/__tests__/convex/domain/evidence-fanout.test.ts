import type { Id } from "@convex/_generated/dataModel";
import {
    fanOutFrozenBranches,
    type BranchDispatch,
} from "@convex/domain/evidenceFanout";
import { expect, test } from "vitest";

function makeBranch(index: number): BranchDispatch {
    return {
        runId: `run:${index}` as Id<"researchRuns">,
        corpusRevisionId: `rev:${index}` as Id<"corpusRevisions">,
        sourceId: `src:${index}` as Id<"sources">,
        acceptedDecisionId: `dec:${index}` as Id<"sourceDecisions">,
        executionGeneration: index,
        origin: index % 2 === 0 ? "sec" : "analyst_url",
    };
}

test("every branch starts before the first settles; only rejecting branches terminalize", async () => {
    const branches = [makeBranch(1), makeBranch(2)];

    // A barrier: branch A cannot settle until branch B has signalled start.
    // Because the dispatcher creates every dispatch promise before awaiting
    // any, B begins even while A is deliberately paused.
    let signalBStarted: () => void = () => {};
    const bStarted = new Promise<void>((resolve) => {
        signalBStarted = resolve;
    });

    const terminalized: Array<{ branch: BranchDispatch; reason: string }> = [];
    let aStarted = false;
    let bStartedFlag = false;

    const rejections = await fanOutFrozenBranches(
        branches,
        async (branch) => {
            if (branch.sourceId === "src:1") {
                aStarted = true;
                // A waits on B's start signal, proving B ran concurrently.
                await bStarted;
                return;
            }
            bStartedFlag = true;
            signalBStarted();
            throw new Error("branch B unexpected failure");
        },
        async (branch, reason) => {
            terminalized.push({ branch, reason });
        },
    );

    expect(aStarted).toBe(true);
    expect(bStartedFlag).toBe(true);
    expect(rejections.map((r) => r.sourceId)).toEqual(["src:2"]);
    expect(terminalized.map((r) => r.branch.sourceId)).toEqual(["src:2"]);
    expect(terminalized[0]?.reason).toBe("branch B unexpected failure");
});
