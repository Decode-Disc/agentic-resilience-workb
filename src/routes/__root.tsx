import {
    createRootRouteWithContext,
    HeadContent,
    Scripts,
} from "@tanstack/react-router";
import { lazy, type ReactNode, Suspense } from "react";
import { PRODUCT_NAME } from "@/config/product";
import favicon from "@/favicon.svg?url";
import type { AppRouterContext } from "@/integrations/convex/router-context";
import appCss from "@/styles.css?url";

const ImpeccableLiveRoot = import.meta.env.DEV
    ? lazy(() => import("@/components/development/impeccable-live-root"))
    : null;

export const Route = createRootRouteWithContext<AppRouterContext>()({
    head: () => ({
        meta: [
            { charSet: "utf-8" },
            {
                name: "viewport",
                content: "width=device-width, initial-scale=1",
            },
            {
                title: PRODUCT_NAME,
            },
            {
                name: "description",
                content:
                    "An evidence-first research workbench for assessing architectural resilience in the agentic economy.",
            },
        ],
        links: [
            { rel: "stylesheet", href: appCss },
            { rel: "icon", href: favicon },
        ],
    }),
    notFoundComponent: () => (
        <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col justify-center gap-3 px-5 py-16">
            <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
                Not found
            </p>
            <h1 className="text-3xl font-medium tracking-tight">
                This research view does not exist.
            </h1>
        </main>
    ),
    shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
    return (
        <html lang="en" suppressHydrationWarning>
            <head>
                <HeadContent />
            </head>
            <body suppressHydrationWarning>
                {children}
                {ImpeccableLiveRoot ? (
                    <Suspense fallback={null}>
                        <ImpeccableLiveRoot />
                    </Suspense>
                ) : null}
                <Scripts />
            </body>
        </html>
    );
}
