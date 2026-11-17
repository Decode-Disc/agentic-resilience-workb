import { createServer } from "vite";

const server = await createServer({
    root: process.cwd(),
    configFile: false,
    envDir: false,
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    resolve: { tsconfigPaths: true },
    appType: "custom",
    optimizeDeps: { noDiscovery: true },
    cacheDir: "/tmp/workbench-sources-approach-cache",
});
try {
    const cli = (await server.ssrLoadModule(
        "/scripts/evaluations/source-selection/sources-approach-cli.ts",
    )) as typeof import("./sources-approach-cli.ts");
    await cli.runSourcesApproachCli(process.argv.slice(2));
} finally {
    await server.close();
}
