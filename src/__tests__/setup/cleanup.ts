import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
}

if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = ResizeObserverMock;
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: (query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        }),
    });
}

afterEach(() => {
    cleanup();
});
