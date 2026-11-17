/**
 * Headless-browser fingerprint hardening for the preview render service.
 *
 * The default Playwright `chromium.launch({ headless: true })` leaks
 * detectable signatures (the `HeadlessChrome` UA token, `navigator.webdriver`,
 * missing locale/timezone) that bot managers such as Cloudflare and Akamai
 * use to return a block page. These helpers replace those signatures with a
 * realistic desktop profile so protected sites are more likely to render
 * their real content instead of an "Access Denied" page.
 *
 * This is best-effort hardening — advanced bot managers (Cloudflare
 * Turnstile, Akamai Bot Manager) may still detect and block automated
 * browsers. There is no guarantee.
 */

/** A real Chrome-on-Linux UA string, replacing the `HeadlessChrome` marker. */
export const STEALTH_USER_AGENT =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

/**
 * An init script injected into every page to neutralize the most common
 * headless-detection signals before any page script runs.
 */
export const STEALTH_INIT_SCRIPT = `
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    window.chrome = window.chrome || { runtime: {} };
`;

/**
 * Launch options for Chromium. `--disable-blink-features=AutomationControlled`
 * stops Blink from setting `navigator.webdriver = true`, the single most
 * reliable bot-detection signal in headless Chrome.
 */
export function buildLaunchOptions(): {
    headless: boolean;
    args: string[];
} {
    return {
        headless: true,
        args: ["--disable-blink-features=AutomationControlled"],
    };
}

export type Viewport = { width: number; height: number };

/**
 * Context options that give the browser a consistent, realistic desktop
 * fingerprint: a real Chrome UA, `en-US` locale, a North-American timezone,
 * no touch, and matching Accept-Language headers.
 */
export function buildBrowserContextOptions(viewport: Viewport): {
    viewport: Viewport;
    userAgent: string;
    locale: string;
    timezoneId: string;
    hasTouch: boolean;
    extraHTTPHeaders: Record<string, string>;
} {
    return {
        viewport,
        userAgent: STEALTH_USER_AGENT,
        locale: "en-US",
        timezoneId: "America/New_York",
        hasTouch: false,
        extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
    };
}
