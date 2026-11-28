import { operationResultValidator } from "@convex/execution/operationResults";
import { v } from "convex/values";
import { sourceMaterialReferenceValidator } from "./sourceRetrievalPolicy";
import { documentarySubmissionValue } from "./sourcesContracts";
export const consultableSourceResult = operationResultValidator(
    v.union(
        v.object({
            ...sourceMaterialReferenceValidator.fields,
            status: v.union(v.literal("complete"), v.literal("partial")),
        }),
        v.object({
            sourceId: sourceMaterialReferenceValidator.fields.sourceId,
            captureId: v.optional(
                sourceMaterialReferenceValidator.fields.captureId,
            ),
            status: v.literal("unavailable"),
            reasonCode: v.string(),
        }),
    ),
);
export const discoveryResult = operationResultValidator(
    v.object({
        needId: v.string(),
        query: v.string(),
        inserted: v.number(),
        total: v.number(),
    }),
);
export const documentarySubmissionResult = operationResultValidator(
    documentarySubmissionValue,
);
