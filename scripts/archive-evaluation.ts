import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
    chmodSync,
    constants,
    copyFileSync,
    createReadStream,
    linkSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import {
    basename,
    dirname,
    isAbsolute,
    join,
    relative,
    resolve,
    sep,
} from "node:path";
import { parseArgs } from "node:util";
import { EVALUATION_ARCHIVE_POLICY } from "../convex/resourcePolicy.ts";

type Source = { origin: string; archivePath: string };
type SelectedFile = {
    source: string;
    path: string;
    bytes: number;
    fingerprint: string;
};

const usage =
    "pnpm evaluation:archive --name NAME --include PATH [--include PATH ...] [--external ALIAS=ABSOLUTE_PATH] [--dry-run]";

const help = `${usage}

Create a verified local snapshot of explicitly selected experiment inputs and results.
Requires Node, Git and GNU tar. Run creation or preview from the repository root.

Options:
  --name NAME                     Snapshot label: 1-64 letters, digits, underscores or hyphens.
                                  Start with a letter or digit; the UTC timestamp is added.
  --include PATH                  Repository file or directory; repeat for more inputs.
  --external ALIAS=ABSOLUTE_PATH   Explicit external input; repeat with distinct aliases.
  --dry-run                       List selected files and total bytes without writing.
  --record-dir ABSOLUTE_PATH      Override the verification record directory.
  --help                          Show this help without requiring a repository.

Example (replace with existing paths):
  pnpm evaluation:archive --name comparison --include path/to/study --external retrieval=/tmp/retained-inputs --dry-run
Remove --dry-run to create the snapshot. Originals and existing snapshots are preserved.
Select the actual protocol, references, captures, request/response and cost journals,
report and relevant code snapshots. No environment file is loaded. Known secret paths,
symlinks, special files and selections overlapping archive storage are refused.
This path guard cannot detect credentials embedded in an ordinary file.

Storage and verification:
  Archive: $XDG_DATA_HOME/agentic-resilience-workbench/evaluation-archives/
           (defaults to ~/.local/share/agentic-resilience-workbench/evaluation-archives/).
  Record:  scripts/evaluations/archives/<UTC-timestamp>-<name>/
  The command stages exact bytes, packs them, restores a separate copy and verifies
  every SHA-256, while checking that selected sources did not change during capture.
  Final JSON reports status: verified, archive, record, fileCount and bytes.
  record.json identifies source mappings, file hashes/sizes, archive hash/location,
  snapshot creation time and Git HEAD/dirty state. A null HEAD means an unborn repository.
  Include uncommitted code explicitly: a Git revision alone does not preserve it.
  Link the retained report to this record. Failed verification publishes no verified record.

Recovery after transferring the archive and checksum records:
  From the archive directory: sha256sum --check /path/to/record/archive.sha256
  Extract into an empty directory:
    tar --extract --gzip --file ARCHIVE --directory EMPTY_DIRECTORY --keep-old-files --no-same-owner
  From that restored directory: sha256sum --check files.sha256
  Repository inputs are under repository/; external inputs under external/<alias>/.
  Restore their working locations explicitly from record.json; do not extract over a live checkout.

This command creates no scheduled or off-machine backup and performs no provider calls.
Byte preservation does not establish semantic correctness or complete reproducibility.
Archiving and historical authorization files grant no inference or deployment permission.
`;

function inside(parent: string, child: string) {
    const path = relative(parent, child);
    return !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`);
}

function inspectPath(path: string) {
    for (let current = path; ; current = dirname(current)) {
        assert(
            !/[\r\n\\]/.test(current),
            "Paths containing newlines or backslashes are unsupported.",
        );
        try {
            assert(
                !lstatSync(current).isSymbolicLink(),
                `Symlink refused: ${current}`,
            );
        } catch (error) {
            if (
                !(
                    error instanceof Error &&
                    "code" in error &&
                    error.code === "ENOENT"
                )
            )
                throw error;
        }
        const name = basename(current);
        assert(
            ![".git", ".convex", ".ssh", "node_modules"].includes(name) &&
                !/^(?:\.env(?:$|\.)|credentials(?:$|[.-])|invitation-otp-codes(?:$|[.-]))/.test(
                    name,
                ) &&
                !(name !== ".local" && /\.(?:local|pem|key)$/i.test(name)),
            `Secret or local configuration path refused: ${current}`,
        );
        if (dirname(current) === current) break;
    }
}

function fingerprint(path: string) {
    const stat = lstatSync(path, { bigint: true });
    assert(stat.isFile(), `Regular file required: ${path}`);
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}

function collect(sources: Source[]) {
    const files = new Map<string, SelectedFile>();
    function visit(source: string, path: string) {
        inspectPath(source);
        const stat = lstatSync(source);
        if (stat.isDirectory()) {
            for (const name of readdirSync(source).sort())
                visit(join(source, name), `${path}/${name}`);
        } else {
            assert(stat.isFile(), `Regular file required: ${source}`);
            files.set(path, {
                source,
                path,
                bytes: stat.size,
                fingerprint: fingerprint(source),
            });
        }
    }
    for (const source of sources) visit(source.origin, source.archivePath);
    assert(files.size > 0, "No files selected.");
    return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}

async function sha256(path: string) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest("hex");
}

function runTar(args: string[]) {
    const env = { ...process.env };
    delete env.TAR_OPTIONS;
    delete env.GZIP;
    execFileSync("tar", args, {
        env,
        timeout: EVALUATION_ARCHIVE_POLICY.commandTimeoutMs,
        maxBuffer: EVALUATION_ARCHIVE_POLICY.commandMaxBufferBytes,
        stdio: ["ignore", "pipe", "pipe"],
    });
}

async function main() {
    const { values } = parseArgs({
        options: {
            name: { type: "string" },
            include: { type: "string", multiple: true },
            external: { type: "string", multiple: true },
            "record-dir": { type: "string" },
            "dry-run": { type: "boolean" },
            help: { type: "boolean" },
        },
    });
    if (values.help) {
        console.log(help);
        return;
    }
    assert(
        values.name && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(values.name),
        usage,
    );
    const repository = process.cwd();
    const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
        encoding: "utf8",
    }).trim();
    assert(resolve(gitRoot) === repository, "Run from the repository root.");
    const archiveDirectory = join(
        process.env.XDG_DATA_HOME || join(homedir(), ".local/share"),
        "agentic-resilience-workbench/evaluation-archives",
    );
    assert(isAbsolute(archiveDirectory), "XDG_DATA_HOME must be absolute.");
    const recordTarget = values["record-dir"];
    assert(
        recordTarget === undefined || isAbsolute(recordTarget),
        "--record-dir must be an absolute path.",
    );
    const recordsDirectory =
        recordTarget === undefined
            ? join(repository, "scripts/evaluations/archives")
            : resolve(recordTarget);
    assert(
        !inside(recordsDirectory, archiveDirectory) &&
            !inside(archiveDirectory, recordsDirectory),
        "Record storage must not overlap archive storage.",
    );
    const sources: Source[] = [];
    for (const input of values.include ?? []) {
        const origin = resolve(repository, input);
        assert(
            inside(repository, origin),
            "Use --external ALIAS=ABSOLUTE_PATH for paths outside the repository.",
        );
        sources.push({
            origin,
            archivePath: `repository/${relative(repository, origin).split(sep).join("/")}`,
        });
    }
    const aliases = new Set<string>();
    for (const input of values.external ?? []) {
        const index = input.indexOf("=");
        const alias = input.slice(0, index);
        const origin = input.slice(index + 1);
        assert(
            index > 0 &&
                /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(alias) &&
                isAbsolute(origin) &&
                !aliases.has(alias),
            "Use distinct --external ALIAS=ABSOLUTE_PATH mappings.",
        );
        aliases.add(alias);
        inspectPath(origin);
        sources.push({
            origin: resolve(origin),
            archivePath: `external/${alias}${lstatSync(origin).isFile() ? `/${basename(origin)}` : ""}`,
        });
    }
    assert(sources.length > 0, usage);
    for (const source of sources) {
        inspectPath(source.origin);
        assert(
            !inside(source.origin, archiveDirectory) &&
                !inside(archiveDirectory, source.origin) &&
                !inside(source.origin, recordsDirectory) &&
                !inside(recordsDirectory, source.origin),
            "Selected inputs must not overlap archive or record storage.",
        );
    }
    inspectPath(archiveDirectory);
    inspectPath(recordsDirectory);
    const files = collect(sources);
    if (values["dry-run"]) {
        console.log(
            JSON.stringify({
                status: "dry_run",
                sources,
                fileCount: files.length,
                bytes: files.reduce((total, file) => total + file.bytes, 0),
                files: files.map(({ path, bytes }) => ({ path, bytes })),
            }),
        );
        return;
    }
    const head = spawnSync(
        "git",
        ["rev-parse", "--verify", "--quiet", "HEAD"],
        { encoding: "utf8" },
    );
    if (head.error) throw head.error;
    assert(
        head.status === 0 || head.status === 1,
        "Cannot identify Git revision.",
    );
    const git = {
        head: head.status === 0 ? head.stdout.trim() : null,
        dirty: Boolean(
            execFileSync(
                "git",
                [
                    "--no-optional-locks",
                    "status",
                    "--porcelain",
                    "--untracked-files=normal",
                ],
                { encoding: "utf8" },
            ).trim(),
        ),
    };
    const createdAt = new Date().toISOString();
    const id = `${createdAt.replace(/[-:.]/g, "")}-${values.name}`;
    const archiveName = `${id}.tar.gz`;
    const finalArchive = join(archiveDirectory, archiveName);
    const recordDirectory = join(recordsDirectory, id);
    mkdirSync(archiveDirectory, { recursive: true, mode: 0o700 });
    const work = mkdtempSync(join(archiveDirectory, ".pending-"));
    let publishedArchive = false;
    let reservedRecord = false;
    let committed = false;
    try {
        const payload = join(work, "payload");
        const inventory = [];
        for (const file of files) {
            assert(
                fingerprint(file.source) === file.fingerprint,
                `Source changed during capture: ${file.source}`,
            );
            const destination = join(payload, file.path);
            mkdirSync(dirname(destination), { recursive: true });
            copyFileSync(file.source, destination, constants.COPYFILE_EXCL);
            const hash = await sha256(destination);
            assert(
                fingerprint(file.source) === file.fingerprint &&
                    (await sha256(file.source)) === hash,
                `Source changed during capture: ${file.source}`,
            );
            inventory.push({
                path: file.path,
                bytes: file.bytes,
                sha256: hash,
            });
        }
        const checksums = inventory
            .map((file) => `${file.sha256}  ${file.path}\n`)
            .join("");
        writeFileSync(join(payload, "files.sha256"), checksums, { flag: "wx" });
        const list = join(work, "files.list");
        writeFileSync(
            list,
            `${[...inventory.map((file) => file.path), "files.sha256"].join("\0")}\0`,
            { flag: "wx" },
        );
        const bundle = join(work, archiveName);
        runTar([
            "--create",
            "--gzip",
            "--file",
            bundle,
            "--directory",
            payload,
            "--null",
            "--verbatim-files-from",
            "--files-from",
            list,
        ]);
        const restored = join(work, "restored");
        mkdirSync(restored);
        runTar([
            "--extract",
            "--gzip",
            "--file",
            bundle,
            "--directory",
            restored,
            "--keep-old-files",
            "--no-same-owner",
        ]);
        for (const file of inventory) {
            assert(
                (await sha256(join(restored, file.path))) === file.sha256,
                `Restored bytes differ: ${file.path}`,
            );
        }
        assert(
            readFileSync(join(restored, "files.sha256"), "utf8") === checksums,
            "Restored inventory differs.",
        );
        const current = collect(sources);
        assert(
            JSON.stringify(current) === JSON.stringify(files),
            "Source selection changed during capture.",
        );
        for (const [index, file] of inventory.entries()) {
            const original = files[index];
            assert(
                original && (await sha256(original.source)) === file.sha256,
                `Source changed during capture: ${file.path}`,
            );
        }
        const record = {
            schemaVersion: 1,
            id,
            createdAt,
            git,
            sources,
            files: inventory,
            archive: {
                path: finalArchive,
                bytes: lstatSync(bundle).size,
                sha256: await sha256(bundle),
            },
            verification: "restored_and_verified",
        };
        linkSync(bundle, finalArchive);
        publishedArchive = true;
        chmodSync(finalArchive, 0o400);
        mkdirSync(recordsDirectory, { recursive: true });
        mkdirSync(recordDirectory);
        reservedRecord = true;
        writeFileSync(join(recordDirectory, "files.sha256"), checksums, {
            flag: "wx",
        });
        writeFileSync(
            join(recordDirectory, "archive.sha256"),
            `${record.archive.sha256}  ${archiveName}\n`,
            { flag: "wx" },
        );
        const stagedRecord = join(recordDirectory, ".record.json.pending");
        writeFileSync(stagedRecord, `${JSON.stringify(record, null, 4)}\n`, {
            flag: "wx",
        });
        linkSync(stagedRecord, join(recordDirectory, "record.json"));
        unlinkSync(stagedRecord);
        committed = true;
        console.log(
            JSON.stringify({
                status: "verified",
                archive: finalArchive,
                record: join(recordDirectory, "record.json"),
                fileCount: inventory.length,
                bytes: inventory.reduce((total, file) => total + file.bytes, 0),
            }),
        );
    } finally {
        if (!committed) {
            if (reservedRecord)
                rmSync(recordDirectory, { recursive: true, force: true });
            if (publishedArchive) rmSync(finalArchive);
        }
        rmSync(work, { recursive: true, force: true });
    }
}

try {
    await main();
} catch (error) {
    console.error(
        `Evaluation archive failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
    process.exitCode = 1;
}
