import { v } from "convex/values";

export const framingQuestionValidator = v.object({
    id: v.string(),
    text: v.string(),
    rationale: v.string(),
    shortLabel: v.string(),
});
export const framingContentValidator = v.object({
    scope: v.string(),
    questions: v.array(framingQuestionValidator),
});
