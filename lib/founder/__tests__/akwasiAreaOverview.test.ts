import { describe, it, expect } from "@jest/globals"
import { buildAreaOverview, areaTagForNote, noteHasAreaTag } from "../akwasiAreaOverview"

describe("buildAreaOverview", () => {
  it("counts open, blocked, waiting and active decisions per area", () => {
    const rows = buildAreaOverview({
      tasks: [
        { area: "product", status: "not_started" },
        { area: "product", status: "blocked" },
        { area: "product", status: "waiting" },
        { area: "sales", status: "completed" },
      ],
      notes: [
        {
          title: "N1",
          created_at: "2026-01-02T00:00:00Z",
          tags: [areaTagForNote("product")],
        },
        {
          title: "N0",
          created_at: "2026-01-03T00:00:00Z",
          tags: [areaTagForNote("product")],
        },
      ],
      decisions: [
        { area: "product", status: "active" },
        { area: "product", status: "active" },
        { area: "strategy", status: "archived" },
      ],
    })
    const product = rows.find((r) => r.area === "product")
    expect(product?.open_tasks).toBe(3)
    expect(product?.blocked_tasks).toBe(1)
    expect(product?.waiting_tasks).toBe(1)
    expect(product?.active_decisions).toBe(2)
    expect(product?.latest_note_title).toBe("N0")
    const sales = rows.find((r) => r.area === "sales")
    expect(sales?.open_tasks).toBe(0)
  })
})

describe("noteHasAreaTag", () => {
  it("detects area tag", () => {
    expect(
      noteHasAreaTag(
        { title: "x", created_at: "2026-01-01T00:00:00Z", tags: ["founder_memory", areaTagForNote("website")] },
        "website"
      )
    ).toBe(true)
    expect(
      noteHasAreaTag({ title: "x", created_at: "2026-01-01T00:00:00Z", tags: ["founder_memory"] }, "website")
    ).toBe(false)
  })
})
