import type { CampaignLimits } from "./qualificationCampaignPolicy";
export const emptyCampaignLimits = (): CampaignLimits => ({
    model: 0,
    search: 0,
    acquisition: 0,
    costUsd: 0,
});
