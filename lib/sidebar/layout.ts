/** Desktop sidebar collapsed state (icon rail). */
export const FINZA_SIDEBAR_COLLAPSED_STORAGE_KEY = "finza_sidebar_collapsed"

export const SIDEBAR_WIDTH_EXPANDED = "16rem"
export const SIDEBAR_WIDTH_COLLAPSED = "4.5rem"

export const SIDEBAR_COLLAPSED_CHANGED_EVENT = "finza:sidebar-collapsed"

export function readSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false
  try {
    return localStorage.getItem(FINZA_SIDEBAR_COLLAPSED_STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

export function writeSidebarCollapsed(collapsed: boolean): void {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(FINZA_SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0")
  } catch {
    /* ignore quota / private mode */
  }
  window.dispatchEvent(new Event(SIDEBAR_COLLAPSED_CHANGED_EVENT))
}
