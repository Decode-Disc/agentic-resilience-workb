const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const project = process.cwd();
const bundle = fs.realpathSync(path.join(project, "node_modules/convex/dist/cli.bundle.cjs"));
const installed = fs.readFileSync(bundle, "utf8");
assert.equal(installed.split("\nvoid main();").length, 2);
const generator = new Module(bundle, module);
generator.filename = bundle;
generator.paths = Module._nodeModulePaths(path.dirname(bundle));
generator._compile(installed.replace("\nvoid main();", "") + "\nmodule.exports = { componentApiDTS, nodeFs, prettier: import_prettier.default };\n", bundle);

async function run() {
    const convex = path.join(project, "convex");
    const config = path.join(convex, "convex.config.ts");
    const root = { path: convex, definitionPath: config, isRoot: true };
    const source = fs.readFileSync(config, "utf8");
    const imports = new Map([...source.matchAll(/^import (\w+) from "([^"]+)\/convex.config";$/gm)].map(([, name, packageName]) => [name, packageName]));
    const components = new Map();
    const childComponents = [...source.matchAll(/^app\.use\((\w+)\);$/gm)].map(([, name]) => {
        const importSpecifier = imports.get(name);
        assert(importSpecifier);
        const definitionPath = Module.createRequire(config).resolve(importSpecifier + "/convex.config");
        const directory = path.dirname(definitionPath);
        components.set(directory, { path: directory, definitionPath, importSpecifier });
        return { name, path: path.relative(convex, directory) };
    });
    assert.equal(childComponents.length, imports.size);
    const { componentApiDTS, nodeFs, prettier } = generator.exports;
    const result = await componentApiDTS(
        { fs: nodeFs, crash: ({ printedMessage }) => { throw new Error(printedMessage); } },
        { analysis: { "": { definition: { childComponents } } } },
        root, root, components, { staticApi: false, useComponentApiImports: true },
    );
    const output = await prettier.format(result, { parser: "typescript", pluginSearchDirs: false });
    const destination = path.join(convex, "_generated/api.d.ts");
    if (process.argv[2] === "write") {
        fs.writeFileSync(destination, output);
    } else {
        assert.equal(output, fs.readFileSync(destination, "utf8"), "Baseline must reproduce the existing declaration byte for byte");
        console.log("Installed generator reproduced the existing root API declaration byte for byte");
    }
}
run().catch((error) => { console.error(error.message); process.exitCode = 1; });
