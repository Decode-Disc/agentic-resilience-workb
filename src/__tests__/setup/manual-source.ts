import rateLimiterTest from "@/__tests__/convex/integrations/rate-limiter-test-register.js";
import { seedSourcePreparation } from "./source-preparation";

/** Creates an authenticated source-review context with the real rate limiter. */
export async function seedManualSource() {
    const fixture = await seedSourcePreparation();
    const { t, runId, corpusRevisionId, userId } = fixture;
    rateLimiterTest.register(t);
    await t.run((ctx) =>
        ctx.db.patch(runId, {
            lifecycleState: "awaiting_source_review",
            executionStatus: "paused",
            pauseReason: "source_review",
            workflowVersion: 2,
        }),
    );
    return {
        ...fixture,
        owned: t.withIdentity({ subject: userId }),
        args: {
            authUserId: userId,
            runId,
            corpusRevisionId,
            requestKey: "request-1",
            url: "https://example.com/report",
        },
    };
}
