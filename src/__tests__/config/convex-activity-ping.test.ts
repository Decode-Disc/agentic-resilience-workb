// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";

const require = createRequire(import.meta.url);
const packageFile = require.resolve("convex/package.json");
const bundle = readFileSync(
    join(dirname(packageFile), "dist/cli.bundle.cjs"),
    "utf8",
);

// Load the installed CLI, replacing its command entrypoint only. A child process
// is essential: the regression exits through the real OneoffContextImpl.
function probe(scenario: "http" | "network" | "cancel" | "start") {
    const root = mkdtempSync(join(tmpdir(), "convex-activity-test-"));
    try {
        if ((bundle.match(/^void main\(\);$/gm) ?? []).length !== 1)
            throw new Error("The installed CLI entrypoint changed");
        const prefix = `
            require = require('node:module').createRequire(${JSON.stringify(packageFile)});
            const scenario = ${JSON.stringify(scenario)};
            let pings = 0, releasePing, nextPing = false;
            globalThis.fetch = async (resource) => {
                const endpoint = new URL(resource).pathname;
                if (endpoint === '/api/local_deployment/start') {
                    return new Response(JSON.stringify({
                        deploymentName: 'fixture-activity', projectId: 1
                    }), { status: scenario === 'start' ? 522 : 200 });
                }
                if (endpoint === '/api/local_deployment/pause')
                    return new Response('{}');
                if (endpoint !== '/api/local_deployment/record_activity')
                    throw new Error('Unexpected network boundary: ' + endpoint);
                pings++;
                if (scenario === 'network' && !nextPing)
                    throw new TypeError('fixture offline');
                if (pings > 1) return new Response('{}');
                if (scenario === 'cancel')
                    return new Promise(resolve => { releasePing = resolve; });
                return new Response('{}', { status: 522 });
            };
        `;
        const entry = `
            (async () => {
                const assert = require('node:assert/strict');
                retryDelay = () => 0;
                const ctx = new OneoffContextImpl();
                ctx.registerCleanup(async () => console.log('fatal-cleanup'));
                if (scenario === 'start') {
                    await bigBrainStart(ctx, { port: 1, projectSlug: 'fixture',
                        teamSlug: 'fixture', instanceName: null });
                    throw new Error('Failed startup unexpectedly returned');
                }
                let backendRunning = false, backendCleanups = 0;
                // Local state discovery, binary installation, process startup and
                // environment import are external setup boundaries for this test.
                getExistingDeployment = async () => null;
                ensureBackendBinaryDownloaded = async () => ({ binaryPath: 'fixture', version: 'fixture' });
                chooseLocalBackendPorts = async () => ({ cloudPort: 1, sitePort: 2 });
                importDefaultEnvVars = async () => {};
                handlePotentialUpgradeAndStart = async () => {
                    backendRunning = true;
                    return { adminKey: 'fixture-only', cleanupHandle: ctx.registerCleanup(async () => {
                        backendRunning = false;
                        backendCleanups++;
                    }) };
                };
                const cleanupHandles = [];
                const register = ctx.registerCleanup.bind(ctx);
                ctx.registerCleanup = callback => {
                    const handle = register(callback);
                    cleanupHandles.push(handle);
                    return handle;
                };
                const timers = new Map(), delays = [];
                const nativeTimeout = globalThis.setTimeout;
                const nativeClear = globalThis.clearTimeout;
                globalThis.setTimeout = (callback, delay, ...args) => {
                    if (delay !== 60000) return nativeTimeout(callback, delay, ...args);
                    const handle = {};
                    delays.push(delay);
                    timers.set(handle, callback);
                    return handle;
                };
                globalThis.clearTimeout = handle => {
                    if (!timers.delete(handle)) nativeClear(handle);
                };
                const settle = async predicate => {
                    for (let i = 0; i < 100; i++) {
                        if (predicate()) return;
                        await new Promise(resolve => nativeTimeout(resolve, 1));
                    }
                    throw new Error('Activity loop did not settle');
                };
                await handleLocalDeployment(ctx, { teamSlug: 'fixture', projectSlug: 'fixture',
                    ports: { cloud: 1, site: 2 }, forceUpgrade: false });
                const cleanup = ctx.removeCleanup(cleanupHandles.at(-1));
                assert.ok(cleanup);
                if (scenario === 'cancel') {
                    await settle(() => typeof releasePing === 'function');
                    await cleanup(0);
                    releasePing(new Response('{}', { status: 522 }));
                    await new Promise(resolve => nativeTimeout(resolve, 20));
                    assert.equal(pings, 1);
                    assert.equal(timers.size, 0);
                    assert.deepEqual(delays, []);
                } else {
                    await settle(() => timers.size === 1);
                    assert.equal(backendRunning, true);
                    assert.equal(backendCleanups, 0);
                    const failedRequests = pings;
                    const [handle, callback] = timers.entries().next().value;
                    timers.delete(handle);
                    nextPing = true;
                    await callback();
                    await settle(() => timers.size === 1);
                    assert.equal(pings, failedRequests + 1);
                    assert.equal(backendRunning, true);
                    assert.equal(backendCleanups, 0);
                    assert.deepEqual(delays, [60000, 60000]);
                    const staleCallback = timers.values().next().value;
                    await cleanup(0);
                    await staleCallback();
                    assert.equal(pings, failedRequests + 1);
                    assert.equal(timers.size, 0);
                }
                assert.equal(backendRunning, false);
                assert.equal(backendCleanups, 1);
                console.log('activity-lifecycle-passed');
            })().catch(error => { console.error(error); process.exitCode = 2; });
        `;
        const filename = join(root, "probe.cjs");
        writeFileSync(
            filename,
            prefix + bundle.replace(/^void main\(\);$/m, entry),
        );
        const result = spawnSync(
            process.execPath,
            ["--no-experimental-webstorage", filename],
            {
                cwd: root,
                env: { PATH: process.env.PATH ?? "" },
                encoding: "utf8",
                timeout: 10_000,
            },
        );
        if (result.error) throw result.error;
        return result;
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

test.each([
    "http",
    "network",
] as const)("%s activity failures warn, preserve the backend and allow the next scheduled ping", (scenario) => {
    const result = probe(scenario);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("activity-lifecycle-passed");
    expect(result.stdout).not.toContain("fatal-cleanup");
    expect(result.stderr).toContain(
        "Could not report local deployment activity",
    );
    if (scenario === "http") expect(result.stderr).toContain("HTTP 522");
});

test("cleanup during an in-flight ping prevents another ping or a misleading warning", () => {
    const result = probe("cancel");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("activity-lifecycle-passed");
    expect(result.stderr).not.toContain(
        "Could not report local deployment activity",
    );
});

test("required local deployment startup still exits and cleans up on HTTP 522", () => {
    const result = probe("start");
    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout.trim()).toBe("fatal-cleanup");
    expect(result.stderr).toContain("local_deployment/start 522");
});
