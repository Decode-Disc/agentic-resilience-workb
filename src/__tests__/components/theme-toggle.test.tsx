import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider } from "next-themes";
import { expect, test } from "vitest";
import { ThemeToggle } from "@/components/theme-toggle";

test("changes and persists the shared theme without a callback from its caller", async () => {
    localStorage.removeItem("theme");
    render(
        <ThemeProvider
            attribute="class"
            defaultTheme="light"
            enableSystem={false}>
            <ThemeToggle />
        </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Switch theme" }));
    await waitFor(() => {
        expect(document.documentElement.classList.contains("dark")).toBe(true);
        expect(localStorage.getItem("theme")).toBe("dark");
    });
    fireEvent.click(screen.getByRole("button", { name: "Switch theme" }));
    await waitFor(() => {
        expect(document.documentElement.classList.contains("dark")).toBe(false);
        expect(localStorage.getItem("theme")).toBe("light");
    });
});
