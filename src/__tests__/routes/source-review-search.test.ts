import { expect, test } from "vitest";
import { Route } from "@/routes/workspace/_protected/$runId";

test("retains a coverage review destination in validated source search parameters", () => {
    const validate = Route.options.validateSearch;
    if (typeof validate !== "function")
        throw new Error("Expected route search validator");
    expect(
        validate({
            section: "sources",
            view: "inspect",
            coverage: "official_commercial_terms",
        }),
    ).toEqual({
        section: "sources",
        view: "inspect",
        coverage: "official_commercial_terms",
    });
});

test("drops malformed and irrelevant source review parameters", () => {
    const validate = Route.options.validateSearch;
    if (typeof validate !== "function")
        throw new Error("Expected route search validator");
    expect(
        validate({
            section: "sources",
            view: "inspect",
            coverage: "made_up_role",
        }),
    ).toEqual({ section: "sources", view: "inspect" });
    expect(
        validate({
            section: "sources",
            view: "made_up_view",
            coverage: "official_commercial_terms",
        }),
    ).toEqual({ section: "sources" });
    expect(
        validate({
            section: "evidence",
            view: "inspect",
            coverage: "official_commercial_terms",
        }),
    ).toEqual({ section: "progress", inventory: 1 });
    expect(
        validate({
            section: "sources",
            view: "adjust",
            coverage: "official_commercial_terms",
        }),
    ).toEqual({ section: "sources", view: "adjust" });
});

test.each([
    ["evidence", { section: "progress", inventory: 1 }],
    ["assessment", { section: "investigation", subsection: "review" }],
    ["map", { section: "synthesis", subsection: "mechanism" }],
    ["brief", { section: "synthesis", subsection: "full-brief" }],
])("keeps the legacy %s destination accessible", (section, destination) => {
    const validate = Route.options.validateSearch;
    if (typeof validate !== "function")
        throw new Error("Expected route search validator");
    expect(validate({ section })).toEqual(destination);
});

test("keeps inventory above the current source review and validates sub-sections", () => {
    const validate = Route.options.validateSearch;
    if (typeof validate !== "function")
        throw new Error("Expected route search validator");
    expect(
        validate({
            section: "sources",
            view: "inspect",
            coverage: "official_commercial_terms",
            inventory: "1",
        }),
    ).toEqual({
        section: "sources",
        view: "inspect",
        coverage: "official_commercial_terms",
        inventory: 1,
    });
    expect(
        validate({ section: "investigation", subsection: "requests" }),
    ).toEqual({ section: "investigation", subsection: "requests" });
    expect(
        validate({
            section: "synthesis",
            subsection: "requests",
            inventory: "true",
        }),
    ).toEqual({ section: "synthesis", subsection: "mechanism" });
});
