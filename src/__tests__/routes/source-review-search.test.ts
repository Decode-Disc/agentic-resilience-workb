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
    ).toEqual({ section: "evidence" });
    expect(
        validate({
            section: "sources",
            view: "adjust",
            coverage: "official_commercial_terms",
        }),
    ).toEqual({ section: "sources", view: "adjust" });
});
