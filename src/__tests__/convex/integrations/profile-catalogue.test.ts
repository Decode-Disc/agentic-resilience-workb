import * as routing from "@convex/integrations/modelRouting";
import { expect, test } from "vitest";

test("adding an agent's profiles preserves the catalogue revision of unchanged prepared models", () => {
    expect(routing).toHaveProperty("nativeProfileCatalogueRevision");
    expect(
        routing.nativeProfileCatalogueRevision(
            {
                profiles: { existing: 100 },
                profileCatalog: "prepared-catalogue",
            },
            { existing: 100, added: 200 },
        ),
    ).toBe("prepared-catalogue");
    expect(
        routing.nativeProfileCatalogueRevision(
            {
                profiles: { existing: 100 },
                profileCatalog: "prepared-catalogue",
            },
            { existing: 101 },
        ),
    ).not.toBe("prepared-catalogue");
    expect(
        routing.nativeProfileCatalogueRevision(
            {
                profiles: { existing: 100 },
                profileCatalog: "prepared-catalogue",
            },
            { added: 200 },
        ),
    ).not.toBe("prepared-catalogue");
});
