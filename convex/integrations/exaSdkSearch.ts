import Exa from "exa-js";
import { createExaDiscoveryAdapter, createExaWebsiteAdapter } from "./exa";
import { readExaApiKey } from "./exaConfiguration";

export function configuredExaSdkDiscovery() {
    const apiKey = readExaApiKey();
    if (!apiKey) return undefined;
    let client: Exa | undefined;
    return createExaDiscoveryAdapter({
        search: (query, options) => {
            client ??= new Exa(apiKey);
            return client.search(query, options);
        },
    });
}

export function configuredExaWebsiteSearch() {
    const apiKey = readExaApiKey();
    if (!apiKey) return undefined;
    let client: Exa | undefined;
    return createExaWebsiteAdapter({
        search: (query, options) => {
            client ??= new Exa(apiKey);
            return client.search(query, options);
        },
    });
}
