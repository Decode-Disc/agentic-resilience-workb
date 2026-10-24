import { useEffect } from "react";

const LIVE_SELECTOR = "script[data-impeccable-live-tanstack]";

/** Loads local design previews only on development pages explicitly opened with ?impeccable=1. */
export default function ImpeccableLiveRoot() {
    useEffect(() => {
        if (
            !import.meta.env.DEV ||
            new URL(window.location.href).searchParams.get("impeccable") !== "1"
        )
            return;
        let cancelled = false;
        let script: HTMLScriptElement | null = null;
        void (async () => {
            try {
                const response = await fetch("/__impeccable/live-connection", {
                    cache: "no-store",
                });
                if (!response.ok) throw new Error("Local helper unavailable");
                const connection: unknown = await response.json();
                if (
                    typeof connection !== "object" ||
                    connection === null ||
                    !("src" in connection) ||
                    typeof connection.src !== "string"
                )
                    throw new Error("Invalid local helper connection");
                if (cancelled) return;
                const existing =
                    document.querySelector<HTMLScriptElement>(LIVE_SELECTOR);
                if (existing?.src === connection.src) return;
                existing?.remove();
                script = document.createElement("script");
                script.src = connection.src;
                script.async = true;
                script.setAttribute("data-impeccable-live-tanstack", "");
                script.setAttribute("data-impeccable-live-script", "true");
                document.head.appendChild(script);
            } catch {
                if (!cancelled)
                    console.warn(
                        "Design tools are unavailable. Start the local Impeccable helper and reload.",
                    );
            }
        })();

        return () => {
            cancelled = true;
            script?.remove();
        };
    }, []);

    return null;
}
