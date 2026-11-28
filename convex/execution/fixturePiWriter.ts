import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ActionCtx } from "@convex/_generated/server";
import type { PiDispatchLease } from "./piSession";

/** Fixture setup owns its writer until the retained evidence or operation is seeded. */
export async function withFixturePiWriter<T>(
    ctx: Pick<ActionCtx, "runMutation">,
    scope: { missionId: Id<"agentMissions">; expectedGeneration: number },
    writer: string,
    execute: (piLease: PiDispatchLease) => Promise<T>,
): Promise<T> {
    const { sessionId, epoch } = await ctx.runMutation(
        internal.execution.piStore.claim,
        { ...scope, writer },
    );
    try {
        return await execute({ sessionId, writer, epoch });
    } finally {
        await ctx.runMutation(internal.execution.piControl.closeWorker, {
            ...scope,
            writer,
        });
    }
}
