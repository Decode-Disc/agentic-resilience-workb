// The /@fs fixture bypasses Vite's HTML transform.
import "@vitejs/plugin-react/preamble";
import { createRoot } from "react-dom/client";
import { SmoothDropdwon } from "@/components/ui/smooth-dropdown";
import "@/styles.css";

const params = new URLSearchParams(location.search);
const align = params.get("align");
if (align !== "start" && align !== "center" && align !== "end")
    throw new Error("Choose a supported fixture alignment");
const root = document.getElementById("root");
if (!root) throw new Error("Fixture root missing");

createRoot(root).render(
    <main style={{ width: 80, margin: "80px auto" }}>
        <SmoothDropdwon
            defaultOpen
            align={align}
            closedWidth={80}
            openWidth={220}
            portalContainer={
                params.get("portal") === "true" ? document.body : null
            }
            header={<input aria-label="Filter options" />}
            items={[{ id: "first", label: "First dossier" }]}
        />
    </main>,
);
