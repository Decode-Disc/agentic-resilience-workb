import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import {
    buildBrowserContextOptions,
    buildLaunchOptions,
    STEALTH_INIT_SCRIPT,
    STEALTH_USER_AGENT,
} from "../stealth.js";

describe("buildLaunchOptions", () => {
    it("launches headless with the automation-controlled flag disabled", () => {
        const options = buildLaunchOptions();
        expect(options.headless).toBe(true);
        expect(options.args).toContain(
            "--disable-blink-features=AutomationControlled",
        );
    });
});

describe("buildBrowserContextOptions", () => {
    it("returns a fingerprint-hardened context", () => {
        const viewport = { width: 1280, height: 720 };
        const options = buildBrowserContextOptions(viewport);

        expect(options.viewport).toEqual(viewport);
        expect(options.userAgent).toBe(STEALTH_USER_AGENT);
        expect(options.locale).toBe("en-US");
        expect(options.timezoneId).toBe("America/New_York");
        expect(options.hasTouch).toBe(false);
        expect(options.extraHTTPHeaders).toMatchObject({
            "Accept-Language": "en-US,en;q=0.9",
        });
    });
});

describe("STEALTH constants", () => {
    it("uses a real Chrome user agent (no HeadlessChrome marker)", () => {
        expect(STEALTH_USER_AGENT).toContain("Chrome/");
        expect(STEALTH_USER_AGENT).not.toMatch(/HeadlessChrome/i);
    });

    it("applies the browser fingerprint before page scripts run", () => {
        const globals = {
            navigator: { webdriver: true, languages: ["fr"], plugins: [] },
            window: {},
        };
        runInNewContext(STEALTH_INIT_SCRIPT, globals);
        expect(globals.navigator.webdriver).toBeUndefined();
        expect(globals.navigator.languages).toEqual(["en-US", "en"]);
        expect(globals.navigator.plugins).toHaveLength(5);
        expect(globals.window).toHaveProperty("chrome.runtime", {});
    });
});
