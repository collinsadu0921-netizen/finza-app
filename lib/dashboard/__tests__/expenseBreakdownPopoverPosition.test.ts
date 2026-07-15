import {
  computeExpenseBreakdownPopoverPosition,
  EXPENSE_BREAKDOWN_POPOVER_WIDTH,
  EXPENSE_BREAKDOWN_VIEWPORT_PADDING,
} from "@/lib/dashboard/expenseBreakdownPopoverPosition"

function mockTrigger(left: number, top: number, width = 16, height = 16): DOMRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

describe("computeExpenseBreakdownPopoverPosition", () => {
  it("opens to the left of a right-edge trigger", () => {
    const trigger = mockTrigger(1180, 200)
    const coords = computeExpenseBreakdownPopoverPosition(trigger, 280, EXPENSE_BREAKDOWN_POPOVER_WIDTH, {
      width: 1280,
      height: 800,
    })

    expect(coords.width).toBe(EXPENSE_BREAKDOWN_POPOVER_WIDTH)
    expect(coords.left).toBeLessThan(trigger.left)
    expect(coords.left + coords.width).toBeLessThanOrEqual(trigger.right + 4)
    expect(coords.top).toBeGreaterThanOrEqual(trigger.bottom)
  })

  it("clamps within viewport padding", () => {
    const trigger = mockTrigger(20, 20)
    const coords = computeExpenseBreakdownPopoverPosition(trigger, 240, EXPENSE_BREAKDOWN_POPOVER_WIDTH, {
      width: 1280,
      height: 800,
    })

    expect(coords.left).toBeGreaterThanOrEqual(EXPENSE_BREAKDOWN_VIEWPORT_PADDING)
    expect(coords.top).toBeGreaterThanOrEqual(EXPENSE_BREAKDOWN_VIEWPORT_PADDING)
  })

  it("flips above when bottom collision would occur", () => {
    const trigger = mockTrigger(900, 460)
    const coords = computeExpenseBreakdownPopoverPosition(trigger, 300, EXPENSE_BREAKDOWN_POPOVER_WIDTH, {
      width: 1280,
      height: 520,
    })

    expect(coords.top).toBeLessThan(trigger.top)
  })

  it("respects narrow viewport max width", () => {
    const trigger = mockTrigger(350, 200)
    const coords = computeExpenseBreakdownPopoverPosition(trigger, 260, EXPENSE_BREAKDOWN_POPOVER_WIDTH, {
      width: 390,
      height: 844,
    })

    expect(coords.width).toBeLessThanOrEqual(390 - EXPENSE_BREAKDOWN_VIEWPORT_PADDING * 2)
    expect(coords.left).toBeGreaterThanOrEqual(EXPENSE_BREAKDOWN_VIEWPORT_PADDING)
    expect(coords.left + coords.width).toBeLessThanOrEqual(390 - EXPENSE_BREAKDOWN_VIEWPORT_PADDING)
  })
})
