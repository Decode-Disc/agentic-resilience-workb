// @vitest-environment node
import { execFile } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, test } from "vitest";

import { servePublicationGuard } from "@/__tests__/setup/convex-publication";

const execute = promisify(execFile);
const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
    await Promise.all(
        servers
            .splice(0)
            .map(
                (server) =>
                    new Promise<void>((resolve, reject) =>
                        server.close((error) =>
                            error ? reject(error) : resolve(),
                        ),
                    ),
            ),
    );
    for (const root of roots.splice(0))
        rmSync(root, { recursive: true, force: true });
});

async function publicationFixture(
    options: {
        activeWorkers?: boolean;
        deployFails?: boolean;
        unavailable?: boolean;
        delayMs?: number;
    } = {},
) {
    const root = mkdtempSync(join(tmpdir(), "pi-publication-test-"));
    roots.push(root);
    const state = { held: false, ...options };
    const server = createServer(async (request, response) => {
        if (request.url === "/instance_name") {
            response.end("local-publication-test");
            return;
        }
        if (!(await servePublicationGuard(request, response, state)))
            response.writeHead(404).end();
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
        throw new Error("Missing fixture listener");
    mkdirSync(join(root, ".convex/local/default"), { recursive: true });
    mkdirSync(join(root, "node_modules/convex/bin"), { recursive: true });
    writeFileSync(
        join(root, ".env.local"),
        "CONVEX_DEPLOYMENT=local:local-publication-test\n",
    );
    writeFileSync(
        join(root, ".convex/local/default/config.json"),
        JSON.stringify({
            deploymentName: "local-publication-test",
            adminKey: "fixture-only-admin",
            ports: { cloud: address.port },
        }),
    );
    const log = join(root, "publication.log");
    writeFileSync(
        join(root, "node_modules/convex/bin/main.js"),
        `require('node:fs').appendFileSync(${JSON.stringify(log)}, 'deploy\\n'); setTimeout(() => process.exit(${options.deployFails ? 1 : 0}), ${options.delayMs ?? 0});`,
    );
    const env = { ...process.env };
    delete env.CONVEX_DEPLOYMENT;
    delete env.CONVEX_DEPLOY_KEY;
    const run = (...args: string[]) =>
        execute(
            process.execPath,
            [
                "--experimental-strip-types",
                resolve("scripts/sync-local-convex.ts"),
                "--url",
                `http://127.0.0.1:${address.port}`,
                ...args,
            ],
            { cwd: root, env, timeout: 10000 },
        );
    return {
        run,
        held: () => state.held,
        deployed: () => existsSync(log) && readFileSync(log, "utf8").length > 0,
    };
}

test("the local publisher refuses active workers and leaves admission held", async () => {
    const fixture = await publicationFixture({ activeWorkers: true });
    await expect(fixture.run()).rejects.toThrow();
    expect(fixture.deployed()).toBe(false);
    expect(fixture.held()).toBe(true);
});

test("a successful quiet publication releases only its own automatic hold", async () => {
    const fixture = await publicationFixture();
    await fixture.run();
    expect(fixture.deployed()).toBe(true);
    expect(fixture.held()).toBe(false);
});

test("an explicit hold survives a successful manual publication until explicitly released", async () => {
    const fixture = await publicationFixture();
    await fixture.run("--hold");
    expect(fixture.held()).toBe(true);
    expect(fixture.deployed()).toBe(false);
    await fixture.run();
    expect(fixture.held()).toBe(true);
    await fixture.run("--release");
    expect(fixture.held()).toBe(false);
});

test("a failed deployment keeps admission held for inspection and retry", async () => {
    const fixture = await publicationFixture({ deployFails: true });
    await expect(fixture.run()).rejects.toThrow();
    expect(fixture.deployed()).toBe(true);
    expect(fixture.held()).toBe(true);
});

test("an unavailable publication guard refuses the push before changing admission", async () => {
    const fixture = await publicationFixture({ unavailable: true });
    await expect(fixture.run()).rejects.toThrow();
    expect(fixture.deployed()).toBe(false);
    expect(fixture.held()).toBe(false);
});

test("concurrent publication commands cannot release each other's hold", async () => {
    const fixture = await publicationFixture({ delayMs: 500 });
    const results = await Promise.allSettled([fixture.run(), fixture.run()]);
    expect(
        results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
        results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(fixture.deployed()).toBe(true);
    expect(fixture.held()).toBe(false);
});
