import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { FullConfig } from "@playwright/test";

import { runConvexCli } from "./support/convex-cli";

type InvitationMaterial = {
    invitationCodePepper: string;
    invitationSeedConfig: string;
};

export default async function globalSetup(_config: FullConfig) {
    const material = JSON.parse(
        readFileSync(
            resolve(process.cwd(), "invitation-otp-codes.local"),
            "utf8",
        ),
    ) as InvitationMaterial;

    runConvexCli([
        "env",
        "set",
        "INVITATION_CODE_PEPPER",
        material.invitationCodePepper,
        "--deployment",
        "local",
    ]);
    runConvexCli([
        "env",
        "set",
        "INVITATION_SEED_CONFIG",
        material.invitationSeedConfig,
        "--deployment",
        "local",
    ]);
    runConvexCli([
        "env",
        "set",
        "E2E_FIXTURES_ENABLED",
        "true",
        "--deployment",
        "local",
    ]);
    runConvexCli([
        "run",
        "invitations:bootstrapConfigured",
        "{}",
        "--deployment",
        "local",
    ]);
}