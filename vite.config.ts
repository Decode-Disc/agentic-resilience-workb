import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
    resolve: {
        tsconfigPaths: true,
    },
    plugins: [tailwindcss(), tanstackStart(), viteReact()],
    server: {
        watch: {
            ignored: [
                '**/.ai/**',
                '**/.pi/**',
                '**/.codex/**',
                '**/src/__tests__/**',
            ],
        },
    },
});
