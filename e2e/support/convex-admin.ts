/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { convexToJson, jsonToConvex, type Value } from "convex/values";

import { resolveLocalRuntime } from "../../scripts/local-runtime.ts";

export const CONVEX_ADMIN_ERROR =
    "Local Convex admin request failed. No function, arguments, or response are exposed.";

export type ConvexAdminRequest =
    | { kind: "function"; path: string; args: Record<string, unknown> }
    | {
          kind: "environment";
          changes: Array<{ name: string; value: string | null }>;
      };

/** Resolves to the decoded function value; any rejection is sanitized by the caller. */
export type ConvexAdminExecutor = (request: ConvexAdminRequest) => Promise<unknown>;

type LocalDeployment = { origin: string; adminKey: string };

let deployment: Promise<LocalDeployment> | undefined;

/** Verifies the selected local deployment once per process, then reuses its origin and admin key, the authority the Convex CLI itself uses. */
function localDeployment(): Promise<LocalDeployment> {
    deployment ??= (async () => {
        const runtime = await resolveLocalRuntime(process.cwd(), {
            requiredOrigins: ["convex"],
            verificationScope: "required",
        });
        const config = JSON.parse(
            readFileSync(
                resolve(runtime.identity.root, ".convex/local/default/config.json"),
                "utf8",
            ),
        ) as { adminKey?: unknown };
        if (typeof config.adminKey !== "string") throw new Error();
        return { origin: runtime.origins.convex, adminKey: config.adminKey };
    })();
    return deployment;
}

/** In-process admin requests to the local backend: no child process, no CLI start-up per call. */
export const defaultConvexAdminExecutor: ConvexAdminExecutor = async (
    request,
) => {
    const { origin, adminKey } = await localDeployment();
    const headers = {
        Authorization: `Convex ${adminKey}`,
        "Content-Type": "application/json",
    };
    if (request.kind === "environment") {
        const response = await fetch(
            `${origin}/api/update_environment_variables`,
            {
                method: "POST",
                headers,
                body: JSON.stringify({ changes: request.changes }),
            },
        );
        if (!response.ok) throw new Error();
        return null;
    }
    const response = await fetch(`${origin}/api/function`, {
        method: "POST",
        headers,
        body: JSON.stringify({
            path: request.path,
            format: "convex_encoded_json",
            args: convexToJson(request.args as Value),
        }),
    });
    const body = (await response.json()) as {
        status?: string;
        value?: unknown;
    };
    if (body.status !== "success") throw new Error();
    return jsonToConvex(body.value as Parameters<typeof jsonToConvex>[0]);
};

/** Every failure rejects with the single constant {@link CONVEX_ADMIN_ERROR}: no function, arguments, response, cause or secret is attached, and nothing is logged. */
async function sanitized<T>(work: () => Promise<T>): Promise<T> {
    try {
        return await work();
    } catch {
        throw new Error(CONVEX_ADMIN_ERROR);
    }
}

/** Runs a local Convex function, internal ones included, as the deployment administrator. */
export function runConvexJson<TResult>(
    functionName: string,
    args: Record<string, unknown>,
    executor: ConvexAdminExecutor = defaultConvexAdminExecutor,
): Promise<TResult> {
    return sanitized(
        async () =>
            (await executor({
                kind: "function",
                path: functionName,
                args,
            })) as TResult,
    );
}

/** Sets (string) or removes (null) local deployment environment variables. */
export function setConvexEnvironment(
    changes: Record<string, string | null>,
    executor: ConvexAdminExecutor = defaultConvexAdminExecutor,
): Promise<void> {
    return sanitized(async () => {
        await executor({
            kind: "environment",
            changes: Object.entries(changes).map(([name, value]) => ({
                name,
                value,
            })),
        });
    });
}
