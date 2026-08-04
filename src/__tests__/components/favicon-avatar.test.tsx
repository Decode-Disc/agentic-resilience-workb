import { Building2Icon } from '@hugeicons/core-free-icons';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FaviconAvatar, parseFaviconUrl } from '@/components/favicon-avatar';

describe('parseFaviconUrl', () => {
    it('builds a 64px google favicon request from the host', () => {
        const parsed = parseFaviconUrl('https://example.com/report.pdf');

        expect(parsed).not.toBeNull();
        expect(parsed?.hostname).toBe('example.com');
        expect(parsed?.isHttps).toBe(true);
        expect(parsed?.faviconUrl).toContain(
            'https://www.google.com/s2/favicons',
        );
        expect(parsed?.faviconUrl).toContain('domain=example.com');
        expect(parsed?.faviconUrl).toContain('sz=64');
    });

    it('centers on the host and never leaks the path', () => {
        const parsed = parseFaviconUrl(
            'https://reports.example.org/path/to/document.pdf',
        );

        expect(parsed?.hostname).toBe('reports.example.org');
        expect(parsed?.faviconUrl).not.toContain('/path/to/document.pdf');
    });

    it('flags non-https urls as ineligible for a favicon request', () => {
        expect(parseFaviconUrl('ftp://example.com/file')?.isHttps).toBe(false);
    });

    it('returns null when the url cannot be parsed', () => {
        expect(parseFaviconUrl('not a real url')).toBeNull();
    });
});

describe('FaviconAvatar', () => {
    it('exposes a clear accessible name on the host favicon avatar', () => {
        render(<FaviconAvatar canonicalUrl="https://example.com/report" />);

        expect(screen.getByLabelText(/Favicon for example\.com/i)).toBeTruthy();
    });

    it('falls back to a link icon when the url is not https', () => {
        render(<FaviconAvatar canonicalUrl="ftp://example.com/file" />);

        expect(
            screen.getByLabelText(/Link icon for example\.com/i),
        ).toBeTruthy();
    });

    it('fails over to a generic source label when the url cannot be parsed', () => {
        render(<FaviconAvatar canonicalUrl="not a real url" />);

        expect(screen.getByLabelText(/Source link/i)).toBeTruthy();
    });

    it('centers the accessible label on the entity name when provided', () => {
        render(
            <FaviconAvatar
                canonicalUrl="https://example.com/report"
                entityName="Example Holdings Ltd"
            />,
        );

        expect(
            screen.getByLabelText(/Example Holdings Ltd favicon/i),
        ).toBeTruthy();
    });

    it('renders a custom fallback icon and label when the url is unparseable', () => {
        render(
            <FaviconAvatar
                canonicalUrl=""
                entityName="Example Holdings Ltd"
                fallbackIcon={Building2Icon}
            />,
        );

        // Custom entity label wins for unparseable urls.
        expect(screen.getByLabelText(/Example Holdings Ltd/i)).toBeTruthy();
    });

    // Note on coverage: the `onError` recovery path is wired in the component
    // (`onError={() => setFailed(true)}` forwarded to AvatarImage, which Base
    // UI forwards to the underlying <img>). It is not exercised here because
    // Base UI's Avatar.Image does not emit a real <img> element in jsdom, so
    // we cannot dispatch a synthetic error event on it. The wiring is trivial
    // and visually verifiable in a browser; the contract above (label,
    // fallback icon, hostname) is fully covered.
});
