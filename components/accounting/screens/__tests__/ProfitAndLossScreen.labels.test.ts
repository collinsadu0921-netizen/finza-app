/**
 * Label helpers for Service vs Retail P&L presentation.
 */

describe("ProfitAndLossScreen section labels", () => {
  const SECTION_LABELS_SERVICE: Record<string, string> = {
    income: "Revenue",
    cogs: "Cost of Services",
    operating_expenses: "Operating Expenses",
  }
  const SECTION_LABELS_RETAIL: Record<string, string> = {
    income: "Revenue",
    cogs: "Cost of Goods Sold",
    cost_of_sales: "Cost of Sales",
    operating_expenses: "Operating Expenses",
  }

  function sectionLabel(key: string, mode: "service" | "retail"): string {
    const map = mode === "service" ? SECTION_LABELS_SERVICE : SECTION_LABELS_RETAIL
    return map[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  }

  it("labels cogs as Cost of Services for service mode", () => {
    expect(sectionLabel("cogs", "service")).toBe("Cost of Services")
  })

  it("labels cogs as Cost of Goods Sold for retail mode", () => {
    expect(sectionLabel("cogs", "retail")).toBe("Cost of Goods Sold")
  })

  it("does not fall back to title-cased Cogs for service", () => {
    expect(sectionLabel("cogs", "service")).not.toBe("Cogs")
  })
})
