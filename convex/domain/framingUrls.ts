export function canonicalFramingUrl(value: string) {
    try {
        const url = new URL(value);
        if (
            url.protocol !== "https:" ||
            url.username ||
            url.password ||
            (url.port && url.port !== "443")
        )
            return undefined;
        url.hash = "";
        return url.toString();
    } catch {
        return undefined;
    }
}

export function framingMessageUrls(text: string) {
    return [
        ...new Set(
            (text.match(/https:\/\/[^\s<>()[\]{}"']+/giu) ?? []).flatMap(
                (link) => {
                    const url = canonicalFramingUrl(
                        link.replace(/[.,;!?]+$/u, ""),
                    );
                    return url ? [url] : [];
                },
            ),
        ),
    ];
}

export function messageSuppliesFramingUrl(text: string, canonicalUrl: string) {
    return framingMessageUrls(text).includes(canonicalUrl);
}
