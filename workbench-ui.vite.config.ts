import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const project = process.cwd();
export default defineConfig({
    root: resolve(project, "src/development/workbench-ui"),
    cacheDir: resolve(project, "node_modules/.vite-workbench-ui"),
    resolve: { tsconfigPaths: true },
    plugins: [react(), tailwindcss()],
    server: {
        host: "127.0.0.1",
        port: 3002,
        strictPort: true,
        fs: { allow: [project] },
    },
});
