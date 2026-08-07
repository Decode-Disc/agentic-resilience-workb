/**
 * Shared z-index scale for app chrome and inbox layering.
 */
export const uiLayerOrder = {
    /** Full-page overlay (e.g. reload feedback) must sit above everything. */
    pageOverlay: 49,
    modal: 44,
    expandableScreen: 43,
    workbenchShellHeader: 30,

    /**
     * Radix portalled overlays (dialog, sheet, dropdown, select, tooltip,
     * popover) must sit above the fullscreen inbox so they remain usable
     * when triggered from inside the panel.
     */
    stackedDialog: 38,
} as const;

/**
 * Build Tailwind z-index classes from the shared numeric layer scale.
 */
function buildUiLayerClasses<TLayers extends Record<string, number>>(
    layers: TLayers,
): {
    [TLayer in keyof TLayers]: `z-${TLayers[TLayer]}`;
} {
    return Object.fromEntries(
        Object.entries(layers).map(([layer, value]) => [layer, `z-${value}`]),
    ) as {
        [TLayer in keyof TLayers]: `z-${TLayers[TLayer]}`;
    };
}

/**
 * Tailwind classes aligned with the shared z-index scale.
 */
export const uiLayerClasses = buildUiLayerClasses(uiLayerOrder);
