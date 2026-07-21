import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { WorkbenchShell } from "./workbench-shell"

describe("WorkbenchShell", () => {
  it("states the evidence-first purpose without presenting simulated research", () => {
    render(<WorkbenchShell />)

    expect(
      screen.getByRole("heading", { name: "Agentic Resilience Evidence Workbench" }),
    ).toBeTruthy()
    expect(screen.getByText(/inspectable evidence for architectural resilience/i)).toBeTruthy()
    expect(screen.queryByText(/analysis complete/i)).toBeNull()
  })
})
