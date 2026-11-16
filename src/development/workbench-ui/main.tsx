import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import Icon from "@/components/icon";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button, buttonVariants } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GalleryTheme } from "./gallery-theme";
import "./preview-controls.css";
import { WorkbenchUiRoot } from "@/components/workbench-ui/root";
import "@/styles.css";
import "./gallery.css";
import { ChatCompositionMocks } from "./chat-composition-mocks";
import { examples } from "./examples";
import {
    SourcesScreenPreview,
    sourcesScreenNames,
} from "./sources-screen-examples";
import { StartScreenPreview, startScreenNames } from "./start-screen-examples";

const params = new URLSearchParams(location.search);

/** Workflow previews that share the screen toolbar and browser history. */
const screenLayouts = {
    start: {
        title: "START screens",
        navigationLabel: "Start screen previews",
        names: startScreenNames,
    },
    sources: {
        title: "Sources screens",
        navigationLabel: "Sources screen previews",
        names: sourcesScreenNames,
    },
} as const;
type ScreenLayout = keyof typeof screenLayouts;
const isScreenLayout = (value: string | null): value is ScreenLayout =>
    value === "start" || value === "sources";
const resolveScreen = (layout: string | null, screen: string | null) =>
    isScreenLayout(layout)
        ? ((screenLayouts[layout].names as readonly string[]).find(
              (name) => name === screen,
          ) ?? screenLayouts[layout].names[0])
        : undefined;

const requestedScreen = resolveScreen(
    params.get("layout"),
    params.get("screen"),
);
const groups = {
    "Chat & composer": ["Composer", "RequestItem", "AgentActivity"],
    "Research & evidence": [
        "FramingControls",
        "SourcingLane",
        "Handoff",
        "ProgressTimeline",
        "WorkCard",
        "InventoryDock",
        "InventorySheet",
        "EvidenceMatrix",
        "SourceReader",
        "QuestionCard",
        "HypothesisNode",
        "AppraisalBlock",
        "ControlConclusion",
        "OutcomeCard",
        "MechanismNode",
        "BriefReference",
    ],
    "UI primitives": [
        "DossierSwitcher",
        "OverlayLayers",
        "Chip",
        "GlassPanel",
        "Cover",
        "Button",
        "Badge",
        "WorkspaceNavigation",
    ],
} satisfies Record<string, (keyof typeof examples)[]>;
function Gallery() {
    const { resolvedTheme } = useTheme();
    const theme = resolvedTheme === "dark" ? "dark" : "light";
    const [action, setAction] = useState("");
    const [requested, setRequested] = useState(params.get("component"));
    const [layout, setLayout] = useState(params.get("layout"));
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("All");
    const [viewport, setViewport] = useState("responsive");
    const [activeScreen, setActiveScreen] = useState(requestedScreen);
    const navigateToScreen = (target: ScreenLayout, screen: string) => {
        const url = new URL(location.href);
        url.searchParams.set("layout", target);
        url.searchParams.delete("component");
        url.searchParams.set("screen", screen);
        history.pushState(null, "", url);
        setActiveScreen(screen);
        setLayout(target);
    };
    useEffect(() => {
        const restore = () => {
            const restored = new URLSearchParams(location.search);
            setRequested(restored.get("component"));
            setLayout(restored.get("layout"));
            setActiveScreen(
                resolveScreen(restored.get("layout"), restored.get("screen")),
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
    const openProgress = () => {
        const url = new URL(location.href);
        url.searchParams.delete("layout");
        url.searchParams.delete("screen");
        url.searchParams.set("component", "ProgressTimeline");
        location.assign(url.href);
    };
    const href = (values: Record<string, string>) => {
        const target = new URLSearchParams({ ...values, theme });
        return `?${target}`;
    };
    const header = (
        <header
            className={`gallery-header${activeScreen ? " gallery-screen-header" : ""}`}>
            <div className="gallery-heading">
                <a className="gallery-brand" href={href({})}>
                    Workbench UI
                </a>
                <DropdownMenu>
                    <DropdownMenuTrigger
                        render={<Button variant="secondary" size="sm" />}
                        aria-label="Example navigation">
                        {isScreenLayout(layout)
                            ? screenLayouts[layout].title
                            : layout === "chat-mocks"
                              ? "Design references"
                              : "All examples"}
                        <Icon iconNode={ArrowDown01Icon} size={14} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                        <DropdownMenuItem
                            render={<a href={href({})} />}
                            aria-current={
                                !requested && !layout ? "page" : undefined
                            }>
                            All examples
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            render={
                                <a
                                    href={href({
                                        layout: "start",
                                        screen: "composer",
                                    })}
                                />
                            }
                            aria-current={
                                layout === "start" ? "page" : undefined
                            }>
                            START screens
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            render={
                                <a
                                    href={href({
                                        layout: "sources",
                                        screen: "preparation",
                                    })}
                                />
                            }
                            aria-current={
                                layout === "sources" ? "page" : undefined
                            }>
                            Sources screens
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            render={<a href={href({ layout: "chat-mocks" })} />}
                            aria-current={
                                layout === "chat-mocks" ? "page" : undefined
                            }>
                            Design references
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
                <ThemeToggle />
            </div>
            <p
                className="gallery-disclosure"
                title="Illustrative examples · no research or provider calls">
                <span className="gallery-disclosure-full">
                    Illustrative · no research executed
                </span>
                <span className="gallery-disclosure-short">Illustrative</span>
            </p>
            <output aria-live="polite">{action}</output>
        </header>
    );
    if (layout === "chat-mocks")
        return (
            <>
                {header}
                <p className="gallery-reference-note">
                    Historical composition studies · these references do not
                    represent the current chat controls.
                </p>
                <ChatCompositionMocks theme={theme} />
            </>
        );
    if (activeScreen && isScreenLayout(layout)) {
        const screens = screenLayouts[layout];
        const startScreen = startScreenNames.find(
            (name) => name === activeScreen,
        );
        const sourcesScreen = sourcesScreenNames.find(
            (name) => name === activeScreen,
        );
        return (
            <>
                {header}
                <header className="start-screen-toolbar">
                    <h1>{screens.title}</h1>
                    <nav
                        className="preview-control-group"
                        aria-label={screens.navigationLabel}>
                        {screens.names.map((name) => (
                            <a
                                key={name}
                                className={buttonVariants({
                                    variant:
                                        name === activeScreen
                                            ? "secondary"
                                            : "ghost",
                                    size: "sm",
                                })}
                                href={`?layout=${layout}&screen=${name}&theme=${theme}`}
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
                                    navigateToScreen(layout, name);
                                }}
                                aria-current={
                                    name === activeScreen ? "page" : undefined
                                }>
                                {name}
                            </a>
                        ))}
                    </nav>
                    <div id="start-preview-controls" />
                </header>
                {layout === "start" && startScreen ? (
                    <StartScreenPreview
                        name={startScreen}
                        theme={theme}
                        onStatus={setAction}
                        onNavigate={(screen) =>
                            navigateToScreen("start", screen)
                        }
                        onOpenProgress={openProgress}
                    />
                ) : layout === "sources" && sourcesScreen ? (
                    <SourcesScreenPreview
                        name={sourcesScreen}
                        theme={theme}
                        onNavigate={(screen) =>
                            navigateToScreen("sources", screen)
                        }
                        onOpenProgress={openProgress}
                    />
                ) : null}
            </>
        );
    }
    const selected =
        requested && requested in examples
            ? (requested as keyof typeof examples)
            : undefined;
    const Example = selected ? examples[selected] : undefined;
    return (
        <>
            {header}
            {Example && selected ? (
                <main className="gallery-specimen">
                    <div className="gallery-specimen-heading">
                        <h1>{selected}</h1>
                        <fieldset className="gallery-viewports">
                            <legend>Preview width</legend>
                            {["responsive", "desktop", "mobile"].map((size) => (
                                <Button
                                    key={size}
                                    size="sm"
                                    variant={
                                        viewport === size
                                            ? "secondary"
                                            : "ghost"
                                    }
                                    aria-pressed={viewport === size}
                                    onClick={() => setViewport(size)}>
                                    {size}
                                </Button>
                            ))}
                        </fieldset>
                    </div>
                    <p className="gallery-description">
                        Interactive component fixture. Some reference canvases
                        retain their original width and scroll horizontally.
                    </p>
                    {selected === "Composer" && (
                        <nav
                            className="gallery-composer-states"
                            aria-label="Composer states">
                            {[
                                ["Standard", ""],
                                ["Empty program", "empty"],
                                ["Ready program", "ready"],
                            ].map(([label, program]) => (
                                <a
                                    key={label}
                                    href={href({
                                        component: "Composer",
                                        ...(program ? { program } : {}),
                                    })}
                                    aria-current={
                                        (params.get("program") ?? "") ===
                                        program
                                            ? "page"
                                            : undefined
                                    }>
                                    {label}
                                </a>
                            ))}
                        </nav>
                    )}
                    <div className="gallery-scroll" data-viewport={viewport}>
                        <WorkbenchUiRoot
                            theme={theme}
                            className={`gallery-scene ${selected === "Cover" ? "gallery-cover" : selected === "Button" ? "gallery-buttons" : selected === "InventorySheet" ? "" : "wb-backdrop"}`}
                            data-component={selected}>
                            <Example />
                        </WorkbenchUiRoot>
                    </div>
                </main>
            ) : (
                <main className="gallery-catalogue">
                    <h1>Explore the interface</h1>
                    <p className="gallery-description">
                        Open a screen to follow the workflow, or inspect one
                        component and its interactions.
                    </p>
                    <a
                        className="gallery-screen-entry"
                        href={href({ layout: "start", screen: "composer" })}>
                        <strong>START screens</strong>
                        <span>
                            Compose a request, refine the framing and follow
                            documentary preparation.
                        </span>
                    </a>
                    <a
                        className="gallery-screen-entry"
                        href={href({
                            layout: "sources",
                            screen: "preparation",
                        })}>
                        <strong>Sources screens</strong>
                        <span>
                            Review the prepared material, inspect every source
                            and read what each document contributes.
                        </span>
                    </a>
                    <div className="gallery-filters">
                        <label>
                            Find an example
                            <input
                                type="search"
                                value={query}
                                onChange={(event) =>
                                    setQuery(event.target.value)
                                }
                                placeholder="Composer, sources, navigation…"
                            />
                        </label>
                        <fieldset aria-label="Example categories">
                            {["All", ...Object.keys(groups)].map((group) => (
                                <Button
                                    key={group}
                                    variant={
                                        category === group
                                            ? "secondary"
                                            : "ghost"
                                    }
                                    size="sm"
                                    aria-pressed={category === group}
                                    onClick={() => setCategory(group)}>
                                    {group}
                                </Button>
                            ))}
                        </fieldset>
                    </div>
                    {Object.entries(groups)
                        .filter(
                            ([group]) =>
                                category === "All" || group === category,
                        )
                        .map(([group, names]) => {
                            const matches = names.filter((name) =>
                                name
                                    .toLowerCase()
                                    .includes(query.toLowerCase().trim()),
                            );
                            return matches.length ? (
                                <section
                                    key={group}
                                    className="gallery-category">
                                    <h2>{group}</h2>
                                    <ul>
                                        {matches.map((name) => (
                                            <li key={name}>
                                                <a
                                                    href={href({
                                                        component: name,
                                                    })}>
                                                    {name}
                                                </a>
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            ) : null;
                        })}
                    {!Object.entries(groups).some(
                        ([group, names]) =>
                            (category === "All" || group === category) &&
                            names.some((name) =>
                                name
                                    .toLowerCase()
                                    .includes(query.toLowerCase().trim()),
                            ),
                    ) && (
                        <p role="status">
                            No matching examples. Try another name or category.
                        </p>
                    )}
                </main>
            )}
        </>
    );
}
const mount = document.getElementById("root");
if (!mount) throw new Error("Gallery mount missing");
createRoot(mount).render(
    <GalleryTheme>
        <Gallery />
    </GalleryTheme>,
);
