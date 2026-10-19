import type { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
    claimClassificationLabel,
    claimPolicyLabel,
    dimensionLabel,
    evidenceRelationLabel,
    evidenceSourceOriginLabel,
    locatorLabel,
} from "@/lib/presentation/research-copy";

type EvidenceClaimDetail = FunctionReturnType<
    typeof api.evidenceMatrix.getClaimDetail
>;

/** Read-only detail for one selected evidence claim and its cited passages. */
export function EvidenceClaimDetail({
    detail,
}: {
    detail: EvidenceClaimDetail | null;
}) {
    if (!detail) {
        return (
            <div className="surface-panel flex h-full min-h-64 items-center justify-center rounded-2xl text-sm text-muted-foreground">
                Select a claim to review its cited passages and provenance.
            </div>
        );
    }

    const policyLabel = claimPolicyLabel(detail.policy?.result);
    const evidence = detail.evidence;
    const hasCounter = evidence.some((entry) => entry.relation === "counter");
    const isUnknown = detail.claim.classification === "Unknown";

    return (
        <article
            aria-label={`Claim detail: ${detail.claim.statement}`}
            className="h-full min-w-0 space-y-5 overflow-y-auto p-6">
            <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline">
                    {claimClassificationLabel(detail.claim.classification)}
                </Badge>
                {policyLabel ? (
                    <Badge variant="secondary">{policyLabel}</Badge>
                ) : null}
            </div>

            <h2 className="text-lg leading-7 font-medium">
                {detail.claim.statement}
            </h2>

            {isUnknown || hasCounter ? (
                <div
                    role="note"
                    className="rounded-lg border border-review/30 bg-review/10 p-3 text-xs leading-relaxed text-muted-foreground">
                    {isUnknown
                        ? "This is marked Unknown: the current source set does not resolve the underlying question."
                        : "Counter-evidence is visible above alongside supporting passages."}
                </div>
            ) : null}

            {detail.dimensions.length > 0 ? (
                <>
                    <div>
                        <p className="text-micro text-muted-foreground">
                            Assessment dimensions
                        </p>
                        <ul className="mt-2 space-y-1.5">
                            {detail.dimensions.map((link) => (
                                <li
                                    key={link.dimensionKey}
                                    className="rounded-lg border border-border/40 bg-muted/30 p-2.5 text-sm">
                                    <span className="text-sm font-medium text-foreground">
                                        {dimensionLabel(link.dimensionKey)}
                                    </span>
                                    {link.rationale ? (
                                        <span className="ml-1.5 text-xs text-muted-foreground">
                                            — {link.rationale}
                                        </span>
                                    ) : null}
                                </li>
                            ))}
                        </ul>
                    </div>
                    <Separator />
                </>
            ) : null}

            <div>
                <p className="text-micro text-muted-foreground">
                    Cited passages
                </p>
                {evidence.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                        This claim has no reproducible passage citation.
                    </p>
                ) : (
                    <ol className="mt-3 space-y-4">
                        {evidence.map((entry) => (
                            <li
                                key={entry.sourcePassageId}
                                className="rounded-xl border border-border/50 p-4">
                                <div className="mb-2 flex flex-wrap items-center gap-2">
                                    <Badge variant="secondary">
                                        {evidenceRelationLabel(entry.relation)}
                                    </Badge>
                                    <span className="text-xs text-muted-foreground">
                                        {locatorLabel(entry.locator)}
                                    </span>
                                </div>
                                <blockquote className="border-l-2 pl-4 text-sm leading-6 text-foreground">
                                    “{entry.exactQuotation}”
                                </blockquote>
                                <div className="mt-3 border-t border-border/40 pt-2.5 text-xs text-muted-foreground">
                                    <p className="font-medium text-foreground">
                                        {entry.source.title}
                                    </p>
                                    <p className="mt-1 break-words">
                                        {entry.source.canonicalUrl}
                                    </p>
                                    <p className="mt-1">
                                        {evidenceSourceOriginLabel(
                                            entry.source.origin,
                                        )}
                                    </p>
                                </div>
                            </li>
                        ))}
                    </ol>
                )}
            </div>
        </article>
    );
}
