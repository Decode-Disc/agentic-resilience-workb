#!/usr/bin/env bash
set -euo pipefail

mode=${1:-}
if [[ $# -gt 1 || ( -n $mode && $mode != --without-component ) ]]; then
    echo "Usage: rehearse-in-place.sh [--without-component]" >&2
    exit 2
fi

repository=$(git rev-parse --show-toplevel)
evidence=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
scratch=$(mktemp -d)
trap 'rm -rf -- "$scratch"' EXIT

cd "$repository"
tar -cf - convex src agent-skills scripts public tools package.json tsconfig.json vitest.config.ts |
    tar -xf - -C "$scratch"
mkdir "$scratch/old"
git archive ab98abfb6800eb35f8262ceb7fd034e2c6ee23bb convex |
    tar -xf - -C "$scratch/old"
ln -s "$repository/node_modules" "$scratch/node_modules"

cd "$scratch"
patch -p1 < "$evidence/in-place-rehearsal.patch"
python - "$mode" <<'PY'
from pathlib import Path
import sys

for path in Path("old/convex").rglob("*.ts"):
    path.write_text(path.read_text().replace('"@convex/', '"@baseline-convex/'))

if sys.argv[1] == "--without-component":
    path = Path("src/__tests__/convex/execution/workbench-native-recovery.test.ts")
    test = path.read_text()
    resume = test.index(".resumeVerifiedConversationMigration,")
    wake = test.index("        await t.finishAllScheduledFunctions(", resume)
    test = test[:wake] + """        const { defineSchema } = await import("convex/server");
        // Replace the component registration with an empty module registry in this disposable database.
        t.registerComponent("agent", defineSchema({}), {
            "/_generated/server.ts": async () => ({}),
        });
        await expect(t.run((ctx) =>
            ctx.runQuery(components.agent.messages.getMessagesByIds, { messageIds: [] }),
        )).rejects.toThrow('Could not find module for: "messages"');
""" + test[wake:]
    check = "        expect(sha256Hex(replies[0].text)).toBe(original.contentHash);\n"
    assert test.count(check) == 1
    test = test.replace(check, check + """        const listed = await client.query(api.workbench.history, {
            runId, paginationOpts: { numItems: 10, cursor: null }, bodyAccess: "separate",
        });
        const listedReply = listed.page.find((message) => message._id === deliveryId);
        expect(listedReply?.body).toEqual({ contentHash: original.contentHash });
        let index: number | null = 0;
        let body = "";
        while (index !== null) {
            const fragment: import("convex/server").FunctionReturnType<
                typeof api.execution.conversations.readMessageBody
            > = await client.query(api.execution.conversations.readMessageBody, {
                runId, messageId: deliveryId, contentHash: original.contentHash, index,
            });
            expect(fragment.offset).toBe(body.length);
            body += fragment.content;
            index = fragment.nextIndex;
        }
        expect(body).toBe(replies[0].text);
""")
    path.write_text(test)
PY
./node_modules/.bin/vitest run src/__tests__/convex/execution/workbench-native-recovery.test.ts -t 'migrates and settles in place'

if [[ $mode == --without-component ]]; then (
    cd "$repository"
    setup_path=$(mktemp --suffix=.ts .workbench-rehearsal.XXXXXXXX)
    config_path=
    trap 'rm -f -- "$setup_path" ${config_path:+"$config_path"}' EXIT
    config_path=$(mktemp --suffix=.mts .vitest-rehearsal.XXXXXXXX)
    cat > "$setup_path" <<'TS'
import { vi } from "vitest";

// Suppress only test registration of the retired component.
vi.mock("@convex-dev/agent/test", () => ({ default: { register() {} } }));
TS
    cat > "$config_path" <<TS
import config from "./vitest.config";

export default {
    ...config,
    test: {
        ...config.test,
        setupFiles: [...config.test.setupFiles, "./$setup_path"],
    },
};
TS
    pnpm exec vitest run --config "$config_path" --maxWorkers=1 \
        src/__tests__/convex/sources/sources-instruction-projection.test.ts \
        src/__tests__/convex/sources/sources-instructions.test.ts \
        src/__tests__/convex/execution/workbench-approvals.test.ts \
        src/__tests__/convex/execution/workbench-commands.test.ts
); fi
