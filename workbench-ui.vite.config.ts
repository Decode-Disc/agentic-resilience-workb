import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const project = process.cwd();
const referenceDir = resolve(
    project,
    "src/__tests__/design-system/workbench-ui/references",
);
/** Static frozen references run independently of the React implementation. */
export default defineConfig({
    root: resolve(project, "src/development/workbench-ui"),
    cacheDir: resolve(project, "node_modules/.vite-workbench-ui"),
    resolve: { tsconfigPaths: true },
    plugins: [
        react(),
        tailwindcss(),
        {
            name: "frozen-workbench-references",
            configureServer(server) {
                server.middlewares.use(async (req, res, next) => {
                    const url = new URL(req.url ?? "/", "http://localhost");
                    if (!url.pathname.startsWith("/reference/")) return next();
                    const name = url.pathname.slice("/reference/".length);
                    if (!/^[A-Za-z]+$/.test(name)) {
                        res.statusCode = 404;
                        res.end();
                        return;
                    }
                    try {
                        let [html, tokens, bundle] = await Promise.all([
                            readFile(
                                resolve(referenceDir, `${name}.html`),
                                "utf8",
                            ),
                            readFile(
                                resolve(referenceDir, "tokens.css"),
                                "utf8",
                            ),
                            readFile(
                                resolve(referenceDir, "bundle.css"),
                                "utf8",
                            ),
                        ]);
                        if (name === "WorkCard") {
                            const synthesis = await readFile(
                                resolve(
                                    referenceDir,
                                    "canvas/WorkspaceSynthesis.html",
                                ),
                                "utf8",
                            );
                            html = html.replace(
                                /<div class="ds-dashed wc"[\s\S]*?(?=\n<\/div>\n<\/body>)/,
                                synthesis.trim(),
                            );
                        }
                        if (name === "MechanismNode") {
                            html = await readFile(
                                resolve(
                                    referenceDir,
                                    "canvas/MechanismNodes.html",
                                ),
                                "utf8",
                            );
                            // Keep the complete canvas markup; adapt only its design-tool runtime and font loading.
                            html = html
                                .replace(
                                    '<script src="./support.js"></script>',
                                    "",
                                )
                                .replace(
                                    /<link[^>]*href="ds\/[^"]+"[^>]*>/g,
                                    "",
                                )
                                .replace(
                                    /<link[^>]*href="https:\/\/fonts.googleapis.com[^"]+"[^>]*>/g,
                                    "",
                                )
                                .replaceAll(
                                    "{{theme}}",
                                    url.searchParams.get("theme") === "dark"
                                        ? "dark"
                                        : "light",
                                );
                        }
                        let output = html.replace(
                            '<html lang="en">',
                            `<html lang="en" data-theme="${url.searchParams.get("theme") === "dark" ? "dark" : "light"}">`,
                        );
                        output = output.replace(
                            "<head>",
                            `<head><style>${tokens}\n${bundle.replace(/^@import.*\n/m, "")}\n</style><link rel="stylesheet" href="/reference-fonts.css?direct">`,
                        );
                        output = output
                            .replaceAll(
                                "/_blob/02a51bca00c705378ceed2ee576015ac",
                                `/@fs/${project}/src/assets/logos/logo.png`,
                            )
                            .replaceAll(
                                "/_blob/9198352325a79aa2f89b008f3dfc8f9a",
                                `/@fs/${project}/src/assets/logos/logo-bgdark.png`,
                            );
                        const deltas = await readFile(
                            resolve(referenceDir, "../approved-deltas.css"),
                            "utf8",
                        );
                        output = output
                            .replace("<body", `<body data-approved="${name}"`)
                            .replace(
                                "</head>",
                                `<style>${deltas}</style></head>`,
                            );
                        if (name === "AppraisalBlock") {
                            output = output.replace(
                                /<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">(.*?)<span style="flex:1"><\/span>(.*?)<\/div>\n<\/article>/s,
                                (_, control: string, actions: string) =>
                                    `<footer class="judgment-footer"><div class="judgment-control">${control}</div><div class="judgment-actions">${actions.replaceAll('class="btn"', 'class="ds-button"').replace(/ style="[^"]*"/g, "")}</div></footer>\n</article>`,
                            );
                        }
                        if (name === "OutcomeCard") {
                            const kinds = [
                                "appraisal",
                                "insufficiency",
                                "limited",
                                "non-establishment",
                                "pending",
                                "no-retained",
                                "unfinished",
                                "interruption",
                            ];
                            let index = 0;
                            output = output
                                .replace(
                                    /class="([^"]*\bo)" style=""/g,
                                    (_, classes: string) =>
                                        `class="${classes}" data-outcome="${kinds[index++]}"`,
                                )
                                .replaceAll(
                                    'fill="var(--review)"',
                                    'fill="currentColor"',
                                )
                                .replace(
                                    /(<span class="ds-well") style="[^"]*"/g,
                                    "$1",
                                )
                                .replaceAll(
                                    "font-size:15px;color:var(--muted-foreground)",
                                    "font-size:15px;",
                                );
                        }
                        if (name === "InventorySheet") {
                            const matrix = await readFile(
                                resolve(referenceDir, "EvidenceMatrix.html"),
                                "utf8",
                            );
                            const matrixStyle = matrix.match(
                                /<style>(.*?)<\/style>/s,
                            )?.[1];
                            const body = matrix.match(
                                /<body[^>]*>(.*?)<\/body>/s,
                            )?.[1];
                            if (!matrixStyle || !body)
                                throw new Error(
                                    "Frozen EvidenceMatrix reference is missing its style or body",
                                );
                            let matrixBody = body;
                            const rows = [
                                ...matrixBody.matchAll(
                                    /<div class="grid row">.*<\/div>/g,
                                ),
                            ].map((match) => match[0]);
                            if (rows.length !== 3)
                                throw new Error(
                                    "Frozen EvidenceMatrix reference must contain three illustrative rows",
                                );
                            matrixBody = matrixBody
                                .replace(
                                    rows.join("\n"),
                                    [rows[1], rows[2], rows[0]].join("\n"),
                                )
                                .replace('class="qcard sel"', 'class="qcard"');
                            output = output
                                .replace(
                                    /<span class="ghost"[^>]*><\/span>/g,
                                    "",
                                )
                                .replace(
                                    /<div style="flex:1;border-top:1px solid var\(--divider\);display:flex;align-items:center;justify-content:center">.*?<\/div>/s,
                                    `<div class="inventory-content"><div class="inventory-matrix">${matrixBody}</div></div>`,
                                )
                                .replace(
                                    "</head>",
                                    `<style>@scope (.inventory-matrix) {.use{box-shadow:none}${matrixStyle}}</style></head>`,
                                );
                        }
                        // Approved exceptions. The frozen source stays unchanged; these deltas are explicit.
                        output = output.replace(
                            "</head>",
                            '<style>.ds-button-link{color:var(--accent-foreground)}.ds-button-destructive{color:var(--destructive-text)}:root{--destructive-text:oklch(.48 .19 27.325)}[data-theme="dark"]{--destructive-text:oklch(.82 .12 22.216)}' +
                                (name === "WorkspaceNavigation"
                                    ? ".bar{display:none}.frame{border:0;background:transparent;box-shadow:none}.row{padding:0}"
                                    : "") +
                                "</style></head>",
                        );
                        res.setHeader(
                            "Content-Type",
                            "text/html; charset=utf-8",
                        );
                        res.end(output);
                    } catch (error) {
                        next(error);
                    }
                });
            },
        },
    ],
    server: {
        host: "127.0.0.1",
        port: 3002,
        strictPort: true,
        fs: { allow: [project] },
    },
});
