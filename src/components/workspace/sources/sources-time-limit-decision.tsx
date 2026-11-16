import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { sourcesContinueBlockCopy } from "@/lib/presentation/sources";

function refusalCode(error: unknown) {
    return error instanceof ConvexError &&
        typeof error.data === "object" &&
        error.data &&
        "code" in error.data
        ? String(error.data.code)
        : undefined;
}

/**
 * The analyst's choice after Sources reaches its time limit with capacity left:
 * continue in a new window, or hand off what is prepared. Render it only in the `time_limit` phase;
 * `continueBlock` is the server's readiness verdict, so Continue is disabled with its reason before any attempt.
 */
export function SourcesTimeLimitDecision({
    runId,
    expectedGeneration,
    continueBlock,
    size = "sm",
}: {
    runId: Id<"researchRuns">;
    expectedGeneration: number;
    continueBlock: string | null;
    /** Each surface keeps the button size of its neighbouring actions. */
    size?: "sm" | "lg";
}) {
    const resume = useMutation(api.execution.researchControl.resume);
    const settle = useMutation(api.sourcesMission.settle);
    const [pending, setPending] = useState<"continue" | "settle" | null>(null);
    const [error, setError] = useState<string | null>(null);
    const reasonId = useId();
    const decide = async (choice: "continue" | "settle") => {
        setPending(choice);
        setError(null);
        const args = { runId, expectedGeneration };
        try {
            await (choice === "continue" ? resume(args) : settle(args));
        } catch (caught) {
            const code = refusalCode(caught);
            setError(
                code === "stale_execution" ||
                    code === "human_prerequisite_required"
                    ? "This was already decided. Showing the current state."
                    : code && choice === "continue"
                      ? sourcesContinueBlockCopy(code)
                      : "That action could not be completed. Your prepared material is unchanged. Try again.",
            );
        } finally {
            setPending(null);
        }
    };
    return (
        <div className="flex flex-wrap items-center gap-2">
            <Button
                size={size}
                disabled={!!continueBlock || pending !== null}
                aria-describedby={continueBlock ? reasonId : undefined}
                onClick={() => void decide("continue")}>
                Continue preparation
            </Button>
            <Button
                variant="outline"
                size={size}
                disabled={pending !== null}
                onClick={() => void decide("settle")}>
                Use what's prepared
            </Button>
            {continueBlock ? (
                <p
                    id={reasonId}
                    className="basis-full text-sm text-muted-foreground">
                    {sourcesContinueBlockCopy(continueBlock)}
                </p>
            ) : null}
            {error ? (
                <p
                    role="status"
                    className="basis-full text-sm text-muted-foreground">
                    {error}
                </p>
            ) : null}
        </div>
    );
}
