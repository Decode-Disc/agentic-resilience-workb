import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { impeccableLivePlugin } from "./src/lib/development/impeccable-vite-plugin";

export default defineConfig({
    resolve: {
        tsconfigPaths: true,
    },
    plugins: [
        tailwindcss(),
        tanstackStart(),
        viteReact(),
        impeccableLivePlugin(),
    ],
    server: {
        watch: {
            ignored: [
                "**/.agents/**",
                "**/.ai/**",
                "**/.codex/**",
                "**/.pi/**",
                "**/.github/**",
                "**/context/**",
                "**/docs/**",
                "**/src/__tests__/**",
                "**/.missions/**",
                "**/artifacts/**",
                "**/.impeccable/**",
                "**/.fallow/**",
                "**/.superpowers/**",
                "**/plans/**",
                "**/pi-plans/**",
            ],
        },
    },
    build: {
        rolldownOptions: {
            output: {
                codeSplitting: {
                    groups: [
                        {
                            name: "react-vendor",
                            test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
                            priority: 20,
                        },
                        {
                            name: "base-ui",
                            test: /node_modules[\\/]@base-ui[\\/]/,
                            priority: 15,
                        },
                    ],
                },
            },
        },
    },
});
