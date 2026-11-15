import { api } from "@convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { useEffect, useId, useState } from "react";
import { LoadErrorBoundary } from "@/components/load-error-boundary";
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";
import { Skeleton } from "@/components/ui/skeleton";

type Scope = FunctionArgs<
    typeof api.sourceRetrievalActions.ensureApprovedSourceIndex
>;

/** Searches the approved saved source without changing its membership or analytical claims. */
export function ApprovedSourceSearch({
    runId,
    corpusRevisionId,
    sourceId,
}: Scope) {
    const id = useId();
    const [query, setQuery] = useState("");
    const [settledQuery, setSettledQuery] = useState("");
    const [attempt, setAttempt] = useState(0);
    const [index, setIndex] = useState<{
        attempt: number;
        status: "loading" | "ready" | "unavailable";
    }>({ attempt: 0, status: "loading" });
    const status = index.attempt === attempt ? index.status : "loading";
    const ensureIndex = useAction(
        api.sourceRetrievalActions.ensureApprovedSourceIndex,
    );
    useEffect(() => {
        let active = true;
        void ensureIndex({ runId, corpusRevisionId, sourceId }).then(
            (result) => {
                if (active) setIndex({ attempt, status: result.status });
            },
            () => {
                if (active) setIndex({ attempt, status: "unavailable" });
            },
        );
        return () => {
            active = false;
        };
    }, [runId, corpusRevisionId, sourceId, ensureIndex, attempt]);
    useEffect(() => {
        const timer = setTimeout(() => setSettledQuery(query.trim()), 250);
        return () => clearTimeout(timer);
    }, [query]);
    const invalid = query.trim().split(/\s+/).length > 16;
    return (
        <section
            aria-label="Search captured source"
            className="mt-5 space-y-3 border-t border-border/60 pt-5">
            <Label htmlFor={id}>Search this source</Label>
            <Input
                id={id}
                type="search"
                value={query}
                maxLength={512}
                aria-invalid={invalid}
                aria-describedby={`${id}-help`}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a topic or phrase…"
            />
            <p id={`${id}-help`} className="text-xs text-muted-foreground">
                {invalid
                    ? "Use up to 16 words to narrow your search."
                    : "Search the saved source, including passages outside the initial review. Results still require analytical review."}
            </p>
            {status === "unavailable" ? (
                <LoadErrorAlert
                    variant="inline"
                    title="Source search is unavailable"
                    description="The saved source cannot be searched right now. Try again or inspect the original source."
                    onRetry={() => setAttempt((value) => value + 1)}
                />
            ) : status === "loading" ? (
                <SearchLoading />
            ) : !invalid &&
              settledQuery &&
              settledQuery.split(/\s+/).length <= 16 ? (
                <LoadErrorBoundary
                    key={`${sourceId}:${settledQuery}`}
                    variant="inline"
                    title="Search results could not be loaded"
                    description="Try this search again or inspect the original source.">
                    <SearchResults
                        runId={runId}
                        corpusRevisionId={corpusRevisionId}
                        sourceId={sourceId}
                        query={settledQuery}
                    />
                </LoadErrorBoundary>
            ) : null}
        </section>
    );
}

function SearchLoading() {
    return (
        <div
            role="status"
            aria-label="Preparing source search"
            className="space-y-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-16 w-full" />
            <span className="sr-only">Preparing source search</span>
        </div>
    );
}

function SearchResults({ query, ...scope }: Scope & { query: string }) {
    const result = useQuery(api.sourceRetrieval.searchApprovedSource, {
        ...scope,
        query,
    });
    if (!result || result.status === "not_indexed") return <SearchLoading />;
    if (result.status === "unavailable")
        return (
            <LoadErrorAlert
                variant="inline"
                title="Source search is unavailable"
                description="The saved source cannot be searched. Inspect the original source to continue."
            />
        );
    if (!result.passages.length)
        return (
            <Empty>
                <EmptyHeader>
                    <EmptyTitle>No matching passages</EmptyTitle>
                    <EmptyDescription>
                        Try a different phrase or inspect the original source.
                    </EmptyDescription>
                </EmptyHeader>
            </Empty>
        );
    return (
        <div aria-live="polite" className="space-y-3">
            {result.retrievedAt ? (
                <p className="text-xs text-muted-foreground">
                    Saved{" "}
                    {new Date(result.retrievedAt).toLocaleDateString("en-US", {
                        dateStyle: "medium",
                    })}
                </p>
            ) : null}
            {result.passages.map((passage) => (
                <figure
                    key={passage.order}
                    className="space-y-2 rounded-lg border border-border/60 p-3">
                    {passage.headingPath.length ? (
                        <figcaption className="text-xs font-medium text-muted-foreground">
                            {passage.headingPath.join(" / ")}
                        </figcaption>
                    ) : null}
                    <blockquote className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                        {passage.quotation}
                    </blockquote>
                </figure>
            ))}
            {result.limitReached ? (
                <p className="text-xs text-muted-foreground">
                    Showing the first 64 matches. Narrow your search to find a
                    more specific passage.
                </p>
            ) : null}
        </div>
    );
}
