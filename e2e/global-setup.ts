/// <reference types="node" />
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { FullConfig } from "@playwright/test";

import { workerSlotsFilePath } from "./support/browser-workspace";
import { runConvexJson, setConvexEnvironment } from "./support/convex-admin";

type InvitationMaterial = {
    invitationCodePepper: string;
    invitationSeedConfig: string;
    invitations: Array<{ slotKey: string; role: string; code: string }>;
};

function pickUnusedCode(used: Set<string>, start: number): string {
    for (let candidate = start; candidate <= 9999; candidate += 1) {
        const code = String(candidate).padStart(4, "0");
        if (!used.has(code)) {
            used.add(code);
            return code;
        }
    }
    throw new Error("Exhausted local worker invitation codes");
}

export default async function globalSetup(config: FullConfig) {
    // Each Actions shard owns a fresh loopback deployment and disposable keys.
    if (process.env.GITHUB_ACTIONS === "true") {
        const { privateKey, publicKey } = generateKeyPairSync("rsa", {
            modulusLength: 2048,
        });
        await setConvexEnvironment({
            JWT_PRIVATE_KEY: privateKey
                .export({ type: "pkcs8", format: "pem" })
                .toString()
                .trimEnd()
                .replace(/\n/g, " "),
            JWKS: JSON.stringify({
                keys: [{ use: "sig", ...publicKey.export({ format: "jwk" }) }],
            }),
        });
    }
    const material = JSON.parse(
        readFileSync(
            resolve(process.cwd(), "invitation-otp-codes.local"),
            "utf8",
        ),
    ) as InvitationMaterial;

    await setConvexEnvironment({
        INVITATION_CODE_PEPPER: material.invitationCodePepper,
        INVITATION_SEED_CONFIG: material.invitationSeedConfig,
        E2E_FIXTURES_ENABLED: "true",
    });
    await runConvexJson("invitations:syncE2EWorkerSlots", { slots: [] });
    await runConvexJson("invitations:bootstrapConfigured", {});

    const slotsPath = workerSlotsFilePath();
    const workerCount = Math.max(1, config.workers);
    if (workerCount > 1 && slotsPath) {
        const usedCodes = new Set(
            material.invitations.map((entry) => entry.code),
        );
        const convexSlots: Array<{
            slotKey: string;
            role: "admin" | "analyst";
            code: string;
        }> = [];
        const workers: Record<
            string,
            {
                analystSlotKey: string;
                analystCode: string;
                adminSlotKey: string;
                adminCode: string;
            }
        > = {};
        for (let index = 1; index < workerCount; index += 1) {
            const analystSlotKey = `analyst-4-w${index}`;
            const analystCode = pickUnusedCode(usedCodes, 7100 + index * 10);
            const adminSlotKey = `admin-w${index}`;
            const adminCode = pickUnusedCode(usedCodes, 8100 + index * 10);
            convexSlots.push(
                { slotKey: analystSlotKey, role: "analyst", code: analystCode },
                { slotKey: adminSlotKey, role: "admin", code: adminCode },
            );
            workers[String(index)] = {
                analystSlotKey,
                analystCode,
                adminSlotKey,
                adminCode,
            };
        }
        await runConvexJson("invitations:syncE2EWorkerSlots", {
            slots: convexSlots,
        });
        mkdirSync(dirname(slotsPath), { recursive: true });
        writeFileSync(slotsPath, JSON.stringify({ workers }, null, 2));
    } else if (slotsPath) {
        rmSync(slotsPath, { force: true });
    }
}
