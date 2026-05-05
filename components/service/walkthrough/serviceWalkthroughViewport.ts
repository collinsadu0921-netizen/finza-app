/** Top inset (px): approximate sticky banner + header above main content. */
const VIEWPORT_TOP_INSET = 96
const VIEWPORT_EDGE_PAD = 12

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/**
 * True when enough of the element sits in the "safe" viewport band (below top chrome).
 */
export function isElementReasonablyVisible(el: Element): boolean {
  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return false

  const vh = document.documentElement.clientHeight || window.innerHeight
  const vw = document.documentElement.clientWidth || window.innerWidth

  const bandTop = VIEWPORT_TOP_INSET
  const bandBottom = vh - VIEWPORT_EDGE_PAD
  const bandLeft = VIEWPORT_EDGE_PAD
  const bandRight = vw - VIEWPORT_EDGE_PAD

  const visibleTop = Math.min(r.bottom, bandBottom) - Math.max(r.top, bandTop)
  const visibleLeft = Math.min(r.right, bandRight) - Math.max(r.left, bandLeft)

  const minH = Math.min(72, Math.max(40, r.height * 0.35))
  const minW = Math.min(80, Math.max(32, r.width * 0.25))

  return visibleTop >= minH && visibleLeft >= minW
}

/** Caller should only invoke when the target is not already reasonably visible. */
export function scrollTargetIntoViewSmooth(el: Element): void {
  const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth"
  try {
    el.scrollIntoView({ behavior, block: "center", inline: "nearest" })
  } catch {
    el.scrollIntoView(true)
  }
}

export const REMEASURE_AFTER_SCROLL_MS = 340
