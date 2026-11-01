// @vitest-environment node
import { execFile, spawn, spawnSync } from "node:child_process";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

import { servePublicationGuard } from "@/__tests__/setup/convex-publication";

const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
    await Promise.all(
        servers
            .splice(0)
            .filter((server) => server.listening)
            .map(
                (server) =>
                    new Promise<void>((done, fail) =>
                        server.close((error) => (error ? fail(error) : done())),
                    ),
            ),
    );
    for (const root of roots.splice(0))
        rmSync(root, { recursive: true, force: true });
});

it("checks backend types without starting or synchronizing a backend", () => {
    const root = mkdtempSync(join(tmpdir(), "local-convex-check-"));
    roots.push(root);
    writeFileSync(
        join(root, "package.json"),
        readFileSync(resolve("package.json")),
    );
    const bin = join(root, "node_modules/.bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(
        join(bin, "convex"),
        `#!${process.execPath}\nconsole.error('Backend lifecycle was invoked'); process.exit(23);\n`,
        { mode: 0o755 },
    );
    writeFileSync(
        join(bin, "tsc"),
        `#!${process.execPath}\nconsole.log('Checked backend types: '+process.argv.slice(2).join(' '));\n`,
        { mode: 0o755 },
    );
    const cli = process.env.npm_execpath;
    if (!cli) throw new Error("Run through pnpm test");
    const result = spawnSync(cli, ["convex:check"], {
        cwd: root,
        encoding: "utf8",
        timeout: 10_000,
    });
    if (result.error) throw result.error;
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain(
        "Checked backend types: --noEmit -p convex/tsconfig.json",
    );
    expect(result.stderr).not.toContain("Backend lifecycle was invoked");
});

async function fixture() {
    const root = mkdtempSync(join(tmpdir(), "local-convex-sync-test-"));
    roots.push(root);
    const state = {
        instance: "local-fixture",
        requests: 0,
        redirect: false,
        held: false,
    };
    const server = createServer(async (request, response) => {
        state.requests++;
        if (await servePublicationGuard(request, response, state)) return;
        if (request.url !== "/instance_name") {
            response.writeHead(404).end();
            return;
        }
        if (state.redirect) {
            response
                .writeHead(302, { location: "https://invalid.example/" })
                .end();
            return;
        }
        response.end(state.instance);
    });
    servers.push(server);
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    if (!address || typeof address === "string")
        throw new Error("Missing fixture address");
    const url = `http://127.0.0.1:${address.port}`;
    mkdirSync(join(root, ".convex/local/default"), { recursive: true });
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "node_modules/convex/bin"), { recursive: true });
    symlinkSync(
        resolve("scripts/sync-local-convex.ts"),
        join(root, "scripts/sync-local-convex.ts"),
    );
    writeFileSync(join(root, "package.json"), '{"type":"module"}\n');
    const env =
        "CONVEX_DEPLOYMENT=local:local-fixture\nVITE_CONVEX_URL=preserve-existing-value\n";
    writeFileSync(join(root, ".env.local"), env);
    writeFileSync(join(root, ".env"), "PRESERVE_THIS_FILE=yes\n");
    const config = {
        deploymentName: "local-fixture",
        ports: { cloud: address.port },
        adminKey: "fixture-admin-secret",
    };
    writeFileSync(
        join(root, ".convex/local/default/config.json"),
        JSON.stringify(config),
    );
    // Replace only the external publisher. Files, HTTP identity checks, argument
    // parsing, process execution, credential permissions and cleanup remain real.
    writeFileSync(
        join(root, "node_modules/convex/bin/main.js"),
        `
import {existsSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {parseEnv} from 'node:util';
const args=process.argv.slice(2);
const credentialPath=args[args.indexOf('--env-file')+1];
const credentials=parseEnv(readFileSync(credentialPath,'utf8'));
writeFileSync('publication.json',JSON.stringify({pid:process.pid,args,credentials,credentialPath,mode:statSync(credentialPath).mode&0o777,inheritedSelectors:Object.keys(process.env).filter(key=>['CONVEX_DEPLOY_KEY','CONVEX_DEPLOYMENT','CONVEX_SELF_HOSTED_URL','CONVEX_SELF_HOSTED_ADMIN_KEY'].includes(key))}));
if(existsSync('publication-delay')) await new Promise(done=>setTimeout(done,Number(readFileSync('publication-delay','utf8'))));
console.log('Applied local code');
console.error(credentials.CONVEX_SELF_HOSTED_ADMIN_KEY);
process.exitCode=Number(readFileSync('exit-code','utf8'));
if(existsSync('pause-publication')) setInterval(()=>{},1000);
`,
    );
    writeFileSync(join(root, "exit-code"), "0");
    return { root, url, state, env, config, server };
}

function run(root: string, args: string[], overrides: NodeJS.ProcessEnv = {}) {
    return new Promise<{ status: number; output: string }>((done) => {
        execFile(
            process.execPath,
            [
                "--experimental-strip-types",
                join(root, "scripts/sync-local-convex.ts"),
                ...args,
            ],
            {
                cwd: root,
                encoding: "utf8",
                timeout: 10_000,
                env: {
                    ...process.env,
                    CONVEX_DEPLOYMENT: "local:local-fixture",
                    ...overrides,
                },
            },
            (error, stdout, stderr) =>
                done({
                    status: error
                        ? typeof error.code === "number"
                            ? error.code
                            : 1
                        : 0,
                    output: stdout + stderr,
                }),
        );
    });
}

it("publishes to the verified existing backend without changing environment files or exposing credentials", async () => {
    const { root, url, state, env, config } = await fixture();
    const result = await run(root, ["--url", url], {
        CONVEX_DEPLOY_KEY: "prod:must-not-select",
        CONVEX_SELF_HOSTED_URL: "https://must-not-select.example",
    });
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain(`target: local (local-fixture, ${url})`);
    expect(result.output).toContain("Applied local code");
    expect(result.output).not.toContain(config.adminKey);
    const publication = JSON.parse(
        readFileSync(join(root, "publication.json"), "utf8"),
    );
    expect(publication.args).toEqual([
        "deploy",
        "--env-file",
        publication.credentialPath,
    ]);
    expect(publication.credentials).toEqual({
        CONVEX_SELF_HOSTED_URL: url,
        CONVEX_SELF_HOSTED_ADMIN_KEY: config.adminKey,
    });
    expect(publication.mode).toBe(0o600);
    expect(publication.inheritedSelectors).toEqual([]);
    expect(existsSync(publication.credentialPath)).toBe(false);
    expect(readFileSync(join(root, ".env.local"), "utf8")).toBe(env);
    expect(readFileSync(join(root, ".env"), "utf8")).toBe(
        "PRESERVE_THIS_FILE=yes\n",
    );
    expect(state.requests).toBe(5);
    expect(state.held).toBe(false);
    expect(await (await fetch(`${url}/instance_name`)).text()).toBe(
        "local-fixture",
    );
});

it("propagates publication failure, cleans credentials and preserves the existing backend", async () => {
    const { root, url, env, config } = await fixture();
    writeFileSync(join(root, "exit-code"), "17");
    const result = await run(root, ["--url", url]);
    expect(result.status).toBe(17);
    expect(result.output).toContain("Local synchronization failed");
    expect(result.output).not.toContain(config.adminKey);
    const publication = JSON.parse(
        readFileSync(join(root, "publication.json"), "utf8"),
    );
    expect(existsSync(publication.credentialPath)).toBe(false);
    expect(readFileSync(join(root, ".env.local"), "utf8")).toBe(env);
    expect(await (await fetch(`${url}/instance_name`)).text()).toBe(
        "local-fixture",
    );
});

function acceleratedPublisherClock(root: string): NodeJS.ProcessEnv {
    const clock = join(root, "publisher-clock.mjs");
    // Accelerate only the external process budget; the publisher and identity check remain real.
    writeFileSync(
        clock,
        `
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
const execFile=childProcess.execFile.bind(childProcess);
childProcess.execFile=(file,args,options,callback)=>execFile(file,args,{...options,timeout:args.includes('deploy')?options.timeout/100:options.timeout},callback);
syncBuiltinESMExports();
`,
    );
    return {
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${clock}`,
    };
}

it("lets the publisher complete typechecking beyond the former two-minute budget", async () => {
    const { root, url, env, config } = await fixture();
    writeFileSync(join(root, "publication-delay"), "1800");
    const result = await run(
        root,
        ["--url", url],
        acceleratedPublisherClock(root),
    );
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("Applied local code");
    expect(result.output).not.toContain(config.adminKey);
    const publication = JSON.parse(
        readFileSync(join(root, "publication.json"), "utf8"),
    );
    expect(existsSync(publication.credentialPath)).toBe(false);
    expect(readFileSync(join(root, ".env.local"), "utf8")).toBe(env);
    expect(await (await fetch(`${url}/instance_name`)).text()).toBe(
        "local-fixture",
    );
}, 10_000);

it("reports the publisher timeout, cleans credentials and leaves the backend running", async () => {
    const { root, url, env, config } = await fixture();
    writeFileSync(join(root, "pause-publication"), "yes");
    const result = await run(
        root,
        ["--url", url],
        acceleratedPublisherClock(root),
    );
    expect(result.status).toBe(1);
    expect(result.output).toContain("Local publication timed out");
    expect(result.output).not.toContain(config.adminKey);
    const publication = JSON.parse(
        readFileSync(join(root, "publication.json"), "utf8"),
    );
    expect(() => process.kill(publication.pid, 0)).toThrow(/ESRCH/);
    expect(existsSync(publication.credentialPath)).toBe(false);
    expect(readFileSync(join(root, ".env.local"), "utf8")).toBe(env);
    expect(await (await fetch(`${url}/instance_name`)).text()).toBe(
        "local-fixture",
    );
}, 10_000);

it.each([
    "missing",
    "remote",
    "path",
    "port",
    "override",
])("rejects a %s target before network or publication", async (kind) => {
    const { root, url, state } = await fixture();
    const args =
        kind === "missing"
            ? []
            : kind === "remote"
              ? ["--url", "https://example.com"]
              : kind === "path"
                ? ["--url", `${url}/api`]
                : kind === "port"
                  ? ["--url", "http://127.0.0.1:1"]
                  : ["--url", url, "--prod"];
    const result = await run(root, args);
    expect(result.status).toBe(1);
    expect(state.requests).toBe(0);
    expect(existsSync(join(root, "publication.json"))).toBe(false);
});

it.each([
    "identity",
    "redirect",
])("rejects a running backend with an invalid %s", async (kind) => {
    const { root, url, state } = await fixture();
    if (kind === "identity") state.instance = "another-project";
    else state.redirect = true;
    const result = await run(root, ["--url", url]);
    expect(result.status).toBe(1);
    expect(result.output).toContain(
        kind === "identity" ? "does not match" : "unavailable",
    );
    expect(state.requests).toBe(1);
    expect(existsSync(join(root, "publication.json"))).toBe(false);
});

it("rejects conflicting deployment selection before network or publication", async () => {
    const { root, url, state } = await fixture();
    const result = await run(root, ["--url", url], {
        CONVEX_DEPLOYMENT: "prod:another-project",
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain("conflicts with the environment");
    expect(state.requests).toBe(0);
    expect(existsSync(join(root, "publication.json"))).toBe(false);
});

it("rejects a configured cloud deployment before network or publication", async () => {
    const { root, url, state } = await fixture();
    writeFileSync(
        join(root, ".env.local"),
        "CONVEX_DEPLOYMENT=prod:local-fixture\n",
    );
    const result = await run(root, ["--url", url], {
        CONVEX_DEPLOYMENT: "prod:local-fixture",
    });
    expect(result.status).toBe(1);
    expect(result.output).toContain("configured local deployment");
    expect(state.requests).toBe(0);
    expect(existsSync(join(root, "publication.json"))).toBe(false);
});

it("reports an unavailable backend without attempting to start or publish it", async () => {
    const { root, url, server, env } = await fixture();
    await new Promise<void>((done, fail) =>
        server.close((error) => (error ? fail(error) : done())),
    );
    const result = await run(root, ["--url", url]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("backend is unavailable");
    expect(existsSync(join(root, "publication.json"))).toBe(false);
    expect(readFileSync(join(root, ".env.local"), "utf8")).toBe(env);
});

it("rejects invalid local configuration before network or publication", async () => {
    const { root, url, state, config } = await fixture();
    writeFileSync(
        join(root, ".convex/local/default/config.json"),
        `invalid JSON ${config.adminKey}`,
    );
    const result = await run(root, ["--url", url]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("configuration is missing, invalid");
    expect(result.output).not.toContain(config.adminKey);
    expect(state.requests).toBe(0);
    expect(existsSync(join(root, "publication.json"))).toBe(false);
});

it("cleans credentials on cancellation without stopping the backend", async () => {
    const { root, url, env } = await fixture();
    writeFileSync(join(root, "pause-publication"), "yes");
    const child = spawn(
        process.execPath,
        [
            "--experimental-strip-types",
            join(root, "scripts/sync-local-convex.ts"),
            "--url",
            url,
        ],
        {
            cwd: root,
            stdio: "ignore",
            env: { ...process.env, CONVEX_DEPLOYMENT: "local:local-fixture" },
        },
    );
    const exit = new Promise<number | null>((done, fail) => {
        child.once("error", fail);
        child.once("exit", done);
    });
    try {
        const marker = join(root, "publication.json");
        for (let attempt = 0; !existsSync(marker) && attempt < 100; attempt++)
            await new Promise((done) => setTimeout(done, 20));
        expect(existsSync(marker)).toBe(true);
        const publication = JSON.parse(readFileSync(marker, "utf8"));
        child.kill("SIGTERM");
        expect(await exit).toBe(130);
        expect(() => process.kill(publication.pid, 0)).toThrow(/ESRCH/);
        expect(existsSync(publication.credentialPath)).toBe(false);
        expect(readFileSync(join(root, ".env.local"), "utf8")).toBe(env);
        expect(await (await fetch(`${url}/instance_name`)).text()).toBe(
            "local-fixture",
        );
    } finally {
        child.kill("SIGTERM");
        await exit;
    }
});
