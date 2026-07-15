/** Desktop popover layout constants — tuned for dashboard + Finza Assist FAB clearance. */
export const EXPENSE_BREAKDOWN_POPOVER_WIDTH = 360
export const EXPENSE_BREAKDOWN_VIEWPORT_PADDING = 16
export const EXPENSE_BREAKDOWN_SIDE_OFFSET = 8
/** Reserve bottom-right corner so the popover does not sit under the assistant FAB. */
export const EXPENSE_BREAKDOWN_ASSISTANT_BOTTOM_CLEARANCE = 96
export const EXPENSE_BREAKDOWN_ASSISTANT_RIGHT_CLEARANCE = 72
export const EXPENSE_BREAKDOWN_MOBILE_MAX_WIDTH = 767

export type ExpenseBreakdownViewport = {
  width: number
  height: number
}

export type ExpenseBreakdownPopoverCoords = {
  top: number
  left: number
  width: number
}

function readViewport(override?: ExpenseBreakdownViewport): ExpenseBreakdownViewport {
  if (override) return override
  if (typeof window === "undefined") {
    return { width: 1280, height: 800 }
  }
  return { width: window.innerWidth, height: window.innerHeight }
}

/**
 * Positions the popover to the left of the trigger when possible, with viewport clamping.
 * Prefers below the trigger; flips above when bottom collision would occur.
 */
export function computeExpenseBreakdownPopoverPosition(
  triggerRect: DOMRect,
  popoverHeight: number,
  preferredWidth: number = EXPENSE_BREAKDOWN_POPOVER_WIDTH,
  viewportOverride?: ExpenseBreakdownViewport
): ExpenseBreakdownPopoverCoords {
  const { width: vw, height: vh } = readViewport(viewportOverride)
  const pad = EXPENSE_BREAKDOWN_VIEWPORT_PADDING
  const sideOffset = EXPENSE_BREAKDOWN_SIDE_OFFSET

  const width = Math.min(
    preferredWidth,
    Math.max(280, vw - pad * 2)
  )

  // Anchor right edge of popover to trigger — opens primarily to the left.
  let left = triggerRect.right - width
  let top = triggerRect.bottom + sideOffset

  if (left < pad) {
    left = pad
  }

  const maxRight = vw - pad - EXPENSE_BREAKDOWN_ASSISTANT_RIGHT_CLEARANCE
  if (left + width > maxRight) {
    left = Math.max(pad, maxRight - width)
  }

  const maxBottom = vh - pad - EXPENSE_BREAKDOWN_ASSISTANT_BOTTOM_CLEARANCE
  if (top + popoverHeight > maxBottom) {
    top = triggerRect.top - popoverHeight - sideOffset
  }

  if (top < pad) {
    top = pad
  }

  if (top + popoverHeight > vh - pad) {
    top = Math.max(pad, vh - pad - popoverHeight)
  }

  return { top, left, width }
}

export function isExpenseBreakdownMobileViewport(): boolean {
  if (typeof window === "undefined") return false
  return window.matchMedia(`(max-width: ${EXPENSE_BREAKDOWN_MOBILE_MAX_WIDTH}px)`).matches
}
