import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { WorkbenchUiRoot } from "@/components/workbench-ui/root";
import "@/styles.css";
import "./gallery.css";
import { examples } from "./examples";
import { StartScreenPreview, startScreenNames } from "./start-screen-examples";

const params = new URLSearchParams(location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
document.documentElement.classList.toggle("dark", theme === "dark");
const requested = params.get("component");
const requestedScreen =
    params.get("layout") === "start"
        ? (startScreenNames.find((name) => name === params.get("screen")) ??
          "composer")
        : undefined;
document.body.dataset.single = String(!!requested);
function Gallery() {
    const [action, setAction] = useState("");
    useEffect(() => {
        const listener = (e: Event) =>
            setAction((e as CustomEvent<string>).detail);
        window.addEventListener("workbench-example-action", listener);
        return () =>
            window.removeEventListener("workbench-example-action", listener);
    }, []);
    if (requestedScreen)
        return (
            <>
                <header className="start-screen-toolbar">
                    <h1>START screens</h1>
                    <nav aria-label="Start screen previews">
                        {startScreenNames.map((name) => (
                            <a
                                key={name}
                                className="m-2 underline"
                                href={`?layout=start&screen=${name}&theme=${theme}`}
                                aria-current={
                                    name === requestedScreen
                                        ? "page"
                                        : undefined
                                }>
                                {name}
                            </a>
                        ))}
                    </nav>
                    <a
                        href={`?layout=start&screen=${requestedScreen}&theme=${theme === "dark" ? "light" : "dark"}`}>
                        Switch theme
                    </a>
                    <p>
                        Illustrative screen states. No research is executed.
                        Local controls and navigation work with fictitious data.
                    </p>
                    <output aria-live="polite">{action}</output>
                </header>
                <StartScreenPreview
                    name={requestedScreen}
                    theme={theme}
                    onNavigate={(screen) => {
                        const url = new URL(location.href);
                        url.searchParams.set("screen", screen);
                        location.assign(url.href);
                    }}
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
                        <a
                            href={`?layout=start&screen=composer&theme=${theme}`}>
                            START screens
                        </a>
                    </nav>
                    <p>
                        Illustrative component fixtures. No research is
                        executed.
                    </p>
                    <a href={`/?theme=${theme === "dark" ? "light" : "dark"}`}>
                        Switch theme
                    </a>
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
