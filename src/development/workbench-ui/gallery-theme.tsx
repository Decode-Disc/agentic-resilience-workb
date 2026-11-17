import { ThemeProvider, useTheme } from "next-themes";
import { type ReactNode, useEffect, useRef } from "react";

function readTheme() {
    return new URLSearchParams(location.search).get("theme") === "dark"
        ? "dark"
        : "light";
}

function GalleryThemeLocation() {
    const { theme, setTheme } = useTheme();
    const initialTheme = useRef(readTheme());
    const requestedInitialTheme = useRef(false);
    const initialized = useRef(false);

    useEffect(() => {
        if (!requestedInitialTheme.current) {
            requestedInitialTheme.current = true;
            setTheme(initialTheme.current);
        }
        const restore = () => setTheme(readTheme());
        window.addEventListener("popstate", restore);
        return () => window.removeEventListener("popstate", restore);
    }, [setTheme]);

    useEffect(() => {
        if (!initialized.current && theme !== initialTheme.current) return;
        initialized.current = true;
        const url = new URL(location.href);
        url.searchParams.set("theme", theme === "dark" ? "dark" : "light");
        history.replaceState(history.state, "", url);
    }, [theme]);
    return null;
}

/** Keeps explicit preview URLs authoritative without sharing application theme storage. */
export function GalleryTheme({ children }: { children: ReactNode }) {
    return (
        <ThemeProvider
            attribute="class"
            defaultTheme="light"
            enableSystem={false}
            storageKey="workbench-ui-theme">
            <GalleryThemeLocation />
            {children}
        </ThemeProvider>
    );
}
