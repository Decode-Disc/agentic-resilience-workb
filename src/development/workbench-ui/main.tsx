import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import "./preview-controls.css";
import { WorkbenchUiRoot } from "@/components/workbench-ui/root";
import "@/styles.css";
import "./gallery.css";
import { ChatCompositionMocks } from "./chat-composition-mocks";
import { examples } from "./examples";
import { StartScreenPreview, startScreenNames } from "./start-screen-examples";

const params = new URLSearchParams(location.search);
const initialTheme = params.get("theme") === "dark" ? "dark" : "light";
document.documentElement.classList.toggle("dark", initialTheme === "dark");
const requested = params.get("component");
const requestedScreen =
    params.get("layout") === "start"
        ? (startScreenNames.find((name) => name === params.get("screen")) ??
          "composer")
        : undefined;
document.body.dataset.single = String(!!requested);
function Gallery() {
    const [theme, setTheme] = useState<"light" | "dark">(initialTheme);
    const [action, setAction] = useState("");
    const [activeScreen, setActiveScreen] = useState(requestedScreen);
    const changeTheme = (nextTheme: "light" | "dark") => {
        const url = new URL(location.href);
        url.searchParams.set("theme", nextTheme);
        history.replaceState(history.state, "", url);
        setTheme(nextTheme);
    };
    useEffect(() => {
        document.documentElement.classList.toggle("dark", theme === "dark");
    }, [theme]);
    const navigateToScreen = (screen: (typeof startScreenNames)[number]) => {
        const url = new URL(location.href);
        url.searchParams.set("screen", screen);
        history.pushState(null, "", url);
        setActiveScreen(screen);
    };
    useEffect(() => {
        const restore = () => {
            setTheme(
                new URLSearchParams(location.search).get("theme") === "dark"
                    ? "dark"
                    : "light",
            );
            setActiveScreen(
                startScreenNames.find(
                    (name) =>
                        name ===
                        new URLSearchParams(location.search).get("screen"),
                ) ?? "composer",
            );
        };
        window.addEventListener("popstate", restore);
        return () => window.removeEventListener("popstate", restore);
    }, []);
    useEffect(() => {
        const listener = (e: Event) =>
            setAction((e as CustomEvent<string>).detail);
        window.addEventListener("workbench-example-action", listener);
        return () =>
            window.removeEventListener("workbench-example-action", listener);
    }, []);
    if (params.get("layout") === "chat-mocks")
        return (
            <ChatCompositionMocks theme={theme} onThemeChange={changeTheme} />
        );
    if (activeScreen)
        return (
            <>
                <header className="start-screen-toolbar">
                    <h1>START screens</h1>
                    <nav
                        className="preview-control-group"
                        aria-label="Start screen previews">
                        {startScreenNames.map((name) => (
                            <a
                                key={name}
                                className={buttonVariants({
                                    variant:
                                        name === activeScreen
                                            ? "secondary"
                                            : "ghost",
                                    size: "sm",
                                })}
                                href={`?layout=start&screen=${name}&theme=${theme}`}
                                onClick={(event) => {
                                    if (
                                        event.button !== 0 ||
                                        event.metaKey ||
                                        event.ctrlKey ||
                                        event.shiftKey ||
                                        event.altKey
                                    )
                                        return;
                                    event.preventDefault();
                                    navigateToScreen(name);
                                }}
                                aria-current={
                                    name === activeScreen ? "page" : undefined
                                }>
                                {name}
                            </a>
                        ))}
                    </nav>
                    <div id="start-preview-controls" />
                    <ThemeToggle theme={theme} onThemeChange={changeTheme} />
                    <p>Illustrative · no research executed</p>
                    <output aria-live="polite">{action}</output>
                </header>
                <StartScreenPreview
                    name={activeScreen}
                    theme={theme}
                    onStatus={setAction}
                    onNavigate={navigateToScreen}
                    onOpenProgress={() => {
                        const url = new URL(location.href);
                        url.searchParams.delete("layout");
                        url.searchParams.delete("screen");
                        url.searchParams.set("component", "ProgressTimeline");
                        location.assign(url.href);
                    }}
                />
            </>
        );
    const names =
        requested && requested in examples
            ? [requested as keyof typeof examples]
            : (Object.keys(examples) as (keyof typeof examples)[]);
    return (
        <>
            {!requested && (
                <header className="gallery-header">
                    <h1>Workbench UI</h1>
                    <nav aria-label="Screen previews">
                        <a href={`?layout=chat-mocks&theme=${theme}`}>
                            Chat composition studies
                        </a>
                        <a
                            href={`?layout=start&screen=composer&theme=${theme}`}>
                            START screens
                        </a>
                    </nav>
                    <p>
                        Illustrative component fixtures. No research is
                        executed.
                    </p>
                    <ThemeToggle theme={theme} onThemeChange={changeTheme} />
                    <output aria-live="polite">{action}</output>
                </header>
            )}
            {requested && action && (
                <output className="gallery-notice" aria-live="polite">
                    {action}
                </output>
            )}
            {names.map((name) => {
                const Example = examples[name];
                return (
                    <section key={name} className="gallery-section">
                        {!requested && <h2>{name}</h2>}
                        <div className="gallery-scroll">
                            <WorkbenchUiRoot
                                theme={theme}
                                className={`gallery-scene ${name === "Cover" ? "gallery-cover" : name === "Button" ? "gallery-buttons" : name === "InventorySheet" ? "" : "wb-backdrop"}`}
                                data-component={name}>
                                <Example />
                            </WorkbenchUiRoot>
                        </div>
                    </section>
                );
            })}
        </>
    );
}
const mount = document.getElementById("root");
if (!mount) throw new Error("Gallery mount missing");
createRoot(mount).render(<Gallery />);
