import type { Doc } from "@convex/_generated/dataModel";
import type { ModelRoute } from "./modelRouting";
export type SourceQualificationRoute = ModelRoute & {
    executionPlanVersion?: Doc<"sourceSelectionProposalRebuilds">["executionPlanVersion"];
};

/** Historical evaluation candidates; live qualification and comparison use the administratively pinned Sources model. */
export const sourceQualificationRoutes = [
    { model: "deepseek/deepseek-v4.1-flash", provider: "relace" },
    { model: "deepseek/deepseek-v4.1-flash-1017", provider: "relace" },
] as const satisfies ReadonlyArray<SourceQualificationRoute>;
