import type { Doc } from "@convex/_generated/dataModel";
import type { ModelRoute } from "./modelRouting";
export type SourceQualificationRoute = ModelRoute & {
    executionPlanVersion?: Doc<"sourceSelectionProposalRebuilds">["executionPlanVersion"];
};
export {
    MODEL_ATTEMPT_TIMEOUT_MS as QUALIFICATION_ATTEMPT_TIMEOUT_MS,
    MODEL_MAX_INPUT_PRICE_PER_MILLION as QUALIFICATION_MAX_INPUT_PRICE_PER_MILLION,
    MODEL_MAX_OUTPUT_PRICE_PER_MILLION as QUALIFICATION_MAX_OUTPUT_PRICE_PER_MILLION,
    MODEL_MAX_OUTPUT_TOKENS as QUALIFICATION_MAX_OUTPUT_TOKENS,
} from "./modelRouting";

/** Historical evaluation candidates; live qualification and comparison use the administratively pinned Sources model. */
export const sourceQualificationRoutes = [
    { model: "deepseek/deepseek-v4.1-flash", provider: "relace" },
    { model: "deepseek/deepseek-v4.1-flash-1017", provider: "relace" },
] as const satisfies ReadonlyArray<SourceQualificationRoute>;
