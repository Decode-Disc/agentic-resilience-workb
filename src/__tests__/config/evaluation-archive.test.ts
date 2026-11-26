// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";

const command = resolve("scripts/archive-evaluation.ts");
const temporaryRoots: string[] = [];

function put(path: string, contents: string) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
}

function fixture() {
    const root = mkdtempSync(join(tmpdir(), "evaluation-archive-test-"));
    temporaryRoots.push(root);
    const repository = join(root, "repository");
    mkdirSync(repository);
    execFileSync("git", ["init", "--quiet", repository]);
    return { root, repository, data: join(root, "data") };
}

function archive(
    f: ReturnType<typeof fixture>,
    args: string[],
    env: NodeJS.ProcessEnv = {},
) {
    const result = spawnSync(
        process.execPath,
        ["--experimental-strip-types", command, ...args],
        {
            cwd: f.repository,
            env: { ...process.env, XDG_DATA_HOME: f.data, ...env },
            encoding: "utf8",
            timeout: 20_000,
        },
    );
    if (result.error) throw result.error;
    expect(result.signal).toBeNull();
    return result;
}

afterEach(() => {
    for (const root of temporaryRoots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
    }
});

test("explains archive verification and recovery without requiring a Git repository", () => {
    const f = fixture();
    rmSync(join(f.repository, ".git"), { recursive: true });
    const result = archive(f, ["--help"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("--external ALIAS=ABSOLUTE_PATH");
    expect(result.stdout).toContain("sha256sum --check files.sha256");
    expect(result.stdout).toContain("--keep-old-files");
    expect(readdirSync(f.repository)).toEqual([]);
    expect(existsSync(f.data)).toBe(false);
});

test("archives repository and external evidence and preserves their exact bytes", () => {
    const f = fixture();
    put(
        join(f.repository, "study with spaces/reference.json"),
        "reference v1\n",
    );
    put(join(f.root, "saved hits/results.jsonl"), '{"answer":"unknown"}\n');
    const result = archive(f, [
        "--name",
        "quality-check",
        "--include",
        "study with spaces",
        "--external",
        `retrieval=${join(f.root, "saved hits")}`,
    ]);
    expect(result.status, result.stderr).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.status).toBe("verified");
    const record = JSON.parse(readFileSync(output.record, "utf8"));
    expect(record.git).toEqual({ head: null, dirty: true });
    expect(record.sources).toContainEqual({
        origin: join(f.root, "saved hits"),
        archivePath: "external/retrieval",
    });
    expect(record.files).toHaveLength(2);
    expect(
        createHash("sha256").update(readFileSync(output.archive)).digest("hex"),
    ).toBe(record.archive.sha256);
    const restored = join(f.root, "restored");
    mkdirSync(restored);
    execFileSync("tar", [
        "--extract",
        "--gzip",
        "--file",
        output.archive,
        "--directory",
        restored,
    ]);
    expect(
        readFileSync(
            join(restored, "repository/study with spaces/reference.json"),
            "utf8",
        ),
    ).toBe("reference v1\n");
    expect(
        readFileSync(
            join(restored, "external/retrieval/results.jsonl"),
            "utf8",
        ),
    ).toBe('{"answer":"unknown"}\n');
    expect(
        readFileSync(
            join(f.repository, "study with spaces/reference.json"),
            "utf8",
        ),
    ).toBe("reference v1\n");
    expect(
        readdirSync(join(f.repository, "scripts/evaluations/archives")),
    ).toEqual([record.id]);
});

test("previews the selection without creating an archive or record", () => {
    const f = fixture();
    put(join(f.repository, "captures/report.txt"), "public evidence\n");
    const result = archive(f, [
        "--name",
        "preview",
        "--include",
        "captures",
        "--dry-run",
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
        status: "dry_run",
        fileCount: 1,
        bytes: 16,
    });
    expect(existsSync(f.data)).toBe(false);
    expect(existsSync(join(f.repository, "scripts/evaluations/archives"))).toBe(
        false,
    );
    expect(
        readFileSync(join(f.repository, "captures/report.txt"), "utf8"),
    ).toBe("public evidence\n");
});

test("supports the standard .local/share storage location", () => {
    const f = fixture();
    put(join(f.repository, "result.json"), "public result\n");
    const result = archive(
        f,
        ["--name", "standard-location", "--include", "result.json"],
        {
            XDG_DATA_HOME: join(f.root, ".local/share"),
        },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).archive).toContain(
        join(f.root, ".local/share"),
    );
});

test("keeps earlier snapshots unchanged when archiving the same name again", () => {
    const f = fixture();
    const path = join(f.repository, "result.json");
    put(path, "original\n");
    const args = ["--name", "same-name", "--include", "result.json"];
    const first = archive(f, args);
    expect(first.status, first.stderr).toBe(0);
    const previous = JSON.parse(first.stdout);
    const previousArchive = readFileSync(previous.archive);
    const previousRecord = readFileSync(previous.record);
    put(path, "later result\n");
    const second = archive(f, args);
    expect(second.status, second.stderr).toBe(0);
    expect(JSON.parse(second.stdout).archive).not.toBe(previous.archive);
    expect(readFileSync(previous.archive)).toEqual(previousArchive);
    expect(readFileSync(previous.record)).toEqual(previousRecord);
});

test.each([
    ".env.local",
    "config/credentials.json",
    "access.local",
    ".convex/local/config.json",
])("refuses the known secret path %s without copying its contents", (path) => {
    const f = fixture();
    put(join(f.repository, path), "private-secret-value");
    const result = archive(f, ["--name", "unsafe", "--include", path]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
        "Secret or local configuration path refused",
    );
    expect(result.stdout + result.stderr).not.toContain("private-secret-value");
    expect(existsSync(f.data)).toBe(false);
});

test.each([
    "missing",
    "symlink",
    "external-symlink",
    "implicit-external",
    "recursive-output",
])("rejects an invalid selection before publishing: %s", (scenario) => {
    const f = fixture();
    put(join(f.repository, "source/report.txt"), "saved evidence");
    symlinkSync(join(f.repository, "source"), join(f.repository, "alias"));
    const inputs: Record<string, string[]> = {
        missing: ["--include", "absent.json"],
        symlink: ["--include", "alias/report.txt"],
        "external-symlink": [
            "--external",
            `linked=${join(f.repository, "alias")}`,
        ],
        "implicit-external": ["--include", join(f.root, "outside.txt")],
        "recursive-output": ["--include", "."],
    };
    const result = archive(f, [
        "--name",
        "invalid",
        ...(inputs[scenario] ?? []),
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Evaluation archive failed");
    expect(existsSync(join(f.repository, "scripts/evaluations/archives"))).toBe(
        false,
    );
    expect(existsSync(f.data)).toBe(false);
});

function tarBoundary(f: ReturnType<typeof fixture>, action: string) {
    const binary = join(f.root, "bin/tar");
    const realTar = execFileSync("which", ["tar"], { encoding: "utf8" }).trim();
    put(
        binary,
        `#!${process.execPath}
const { execFileSync } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const { join, dirname, basename } = require("node:path");
const args = process.argv.slice(2);
execFileSync(${JSON.stringify(realTar)}, args);
const action = process.env.ARCHIVE_BOUNDARY_ACTION;
if (args.includes("--create") && action === "change-source") {
    writeFileSync(process.env.ARCHIVE_BOUNDARY_SOURCE, "changed after packing");
}
if (args.includes("--extract") && action === "corrupt-restoration") {
    writeFileSync(join(args[args.indexOf("--directory") + 1], "repository/source/report.txt"), "corrupt");
}
if (args.includes("--create") && action === "occupy-destination") {
    const bundle = args[args.indexOf("--file") + 1];
    writeFileSync(join(dirname(dirname(bundle)), basename(bundle)), "existing archive");
}
`,
    );
    chmodSync(binary, 0o755);
    return {
        PATH: `${dirname(binary)}:${process.env.PATH}`,
        ARCHIVE_BOUNDARY_ACTION: action,
        ARCHIVE_BOUNDARY_SOURCE: join(f.repository, "source/report.txt"),
    };
}

test.each([
    ["change-source", "Source selection changed during capture"],
    ["corrupt-restoration", "Restored bytes differ"],
    ["occupy-destination", "EEXIST"],
])("does not publish a verified record after %s", (action, message) => {
    const f = fixture();
    put(join(f.repository, "source/report.txt"), "original evidence\n");
    const result = archive(
        f,
        ["--name", "failure", "--include", "source"],
        tarBoundary(f, action),
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);
    expect(result.stdout).toBe("");
    expect(existsSync(join(f.repository, "scripts/evaluations/archives"))).toBe(
        false,
    );
    const store = join(
        f.data,
        "agentic-resilience-workbench/evaluation-archives",
    );
    const remaining = readdirSync(store);
    if (action === "occupy-destination") {
        expect(remaining).toHaveLength(1);
        expect(readFileSync(join(store, remaining[0] ?? ""), "utf8")).toBe(
            "existing archive",
        );
    } else {
        expect(remaining).toEqual([]);
    }
});

test("writes automatic archive records to an explicit external directory", () => {
    const f = fixture();
    put(join(f.repository, "evidence.json"), "{}");
    const records = join(f.root, "records");
    const result = archive(f, [
        "--name",
        "automatic",
        "--include",
        "evidence.json",
        "--record-dir",
        records,
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(dirname(dirname(JSON.parse(result.stdout).record))).toBe(records);
    expect(existsSync(join(f.repository, "scripts/evaluations/archives"))).toBe(
        false,
    );
});

test("refuses unsafe record directories before publishing an archive", () => {
    const f = fixture();
    const evidence = join(f.repository, "evidence");
    put(join(evidence, "report.json"), "{}");
    const symlink = join(f.root, "linked");
    symlinkSync(evidence, symlink);
    for (const [records, error] of [
        ["relative", /absolute path/],
        [f.data, /overlap archive storage/],
        [evidence, /overlap/i],
        [symlink, /Symlink refused/],
    ] as const) {
        const result = archive(f, [
            "--name",
            "unsafe",
            "--include",
            "evidence",
            "--record-dir",
            records,
        ]);
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(error);
    }
    expect(existsSync(f.data)).toBe(false);
});
