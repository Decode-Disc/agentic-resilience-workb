import type { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { Badge } from "@/components/ui/badge";
import { claimClassificationLabel } from "@/lib/presentation/research-copy";

type Classification = FunctionReturnType<
    typeof api.evidenceMatrix.listClaims
>["page"][number]["classification"];
const treatments = {
    Fact: { tone: "fact", glyph: "rounded-[2px] bg-current" },
    Inference: {
        tone: "inference",
        glyph: "bg-current [clip-path:polygon(50%_0,100%_100%,0_100%)]",
    },
    Hypothesis: {
        tone: "hypothesis",
        glyph: "rounded-full border-2 border-current",
    },
    Unknown: {
        tone: "unknown",
        glyph: "rounded-full border-[1.5px] border-dashed border-current",
    },
} as const;

/** Keeps each existing claim class readable by label and shape, including in greyscale. */
export function ClaimClassBadge({
    classification,
}: {
    classification: Classification;
}) {
    const treatment = treatments[classification];
    return (
        <Badge tone={treatment.tone}>
            <span
                aria-hidden="true"
                className={`inline-block size-2 shrink-0 ${treatment.glyph}`}
            />
            {claimClassificationLabel(classification)}
        </Badge>
    );
}
