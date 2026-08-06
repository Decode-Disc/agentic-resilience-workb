import { MINUTE, RateLimiter, SECOND } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";

export const rateLimiter = new RateLimiter(components.rateLimiter, {
    secRequests: { kind: "token bucket", rate: 8, period: SECOND },
    exaWebsiteGlobal: {
        kind: "fixed window",
        rate: 25,
        period: 15 * MINUTE,
    },
    exaWebsitePerUser: {
        kind: "fixed window",
        rate: 12,
        period: 15 * MINUTE,
    },
    invitationClaimGlobal: {
        kind: "fixed window",
        rate: 25,
        period: 15 * MINUTE,
    },
    invitationClaimPerUser: {
        kind: "fixed window",
        rate: 5,
        period: 15 * MINUTE,
    },
});
