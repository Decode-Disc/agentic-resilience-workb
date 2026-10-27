import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { WorkbenchUiRoot } from "@/components/workbench-ui/root";
import "@/styles.css";
import "./gallery.css";
import { examples } from "./examples";

const params = new URLSearchParams(location.search);
const theme = params.get("theme") === "dark" ? "dark" : "light";
document.documentElement.classList.toggle("dark", theme === "dark");
const requested = params.get("component");
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
    const names =
        requested && requested in examples
            ? [requested as keyof typeof examples]
            : (Object.keys(examples) as (keyof typeof examples)[]);
    return (
        <>
            {!requested && (
                <header className="gallery-header">
                    <h1>Workbench UI</h1>
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
