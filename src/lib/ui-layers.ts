/**
 * Owns the named global stacking levels for application surfaces.
 */
export const uiLayerOrder = {
    /** Full-page overlay (e.g. reload feedback) must sit above everything. */
    pageOverlay: 999,
    notification: 900,
    contextPanel: 46,
    popup: 60,
    modalContent: 51,
    modal: 50,
    expandableScreen: 43,
    workbenchShellHeader: 30,

    stackedDialog: 38,
    navigationRail: 35,
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
