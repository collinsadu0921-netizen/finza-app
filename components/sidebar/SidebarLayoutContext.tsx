"use client"

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import {
  readSidebarCollapsed,
  SIDEBAR_COLLAPSED_CHANGED_EVENT,
  SIDEBAR_WIDTH_COLLAPSED,
  SIDEBAR_WIDTH_EXPANDED,
  writeSidebarCollapsed,
} from "@/lib/sidebar/layout"

export const SIDEBAR_MAIN_OFFSET_CLASS =
  "lg:pl-[var(--finza-sidebar-width,16rem)] transition-[padding-left] duration-300 ease-in-out"

type SidebarLayoutContextValue = {
  enabled: boolean
  collapsed: boolean
  toggleCollapsed: () => void
}

const SidebarLayoutContext = createContext<SidebarLayoutContextValue>({
  enabled: false,
  collapsed: false,
  toggleCollapsed: () => {},
})

function subscribeCollapsed(onStoreChange: () => void) {
  const handler = () => onStoreChange()
  window.addEventListener("storage", handler)
  window.addEventListener(SIDEBAR_COLLAPSED_CHANGED_EVENT, handler)
  return () => {
    window.removeEventListener("storage", handler)
    window.removeEventListener(SIDEBAR_COLLAPSED_CHANGED_EVENT, handler)
  }
}

export function SidebarLayoutProvider({
  enabled,
  children,
}: {
  enabled: boolean
  children: ReactNode
}) {
  const collapsed = useSyncExternalStore(
    subscribeCollapsed,
    readSidebarCollapsed,
    () => false
  )

  const toggleCollapsed = useCallback(() => {
    writeSidebarCollapsed(!readSidebarCollapsed())
  }, [])

  useLayoutEffect(() => {
    const root = document.documentElement
    if (!enabled) {
      root.style.setProperty("--finza-sidebar-width", "0px")
      return
    }

    const mq = window.matchMedia("(min-width: 1024px)")
    const apply = () => {
      if (!mq.matches) {
        root.style.setProperty("--finza-sidebar-width", "0px")
      } else {
        root.style.setProperty(
          "--finza-sidebar-width",
          collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED
        )
      }
    }

    apply()
    mq.addEventListener("change", apply)
    return () => mq.removeEventListener("change", apply)
  }, [collapsed, enabled])

  return (
    <SidebarLayoutContext.Provider value={{ enabled, collapsed, toggleCollapsed }}>
      {children}
    </SidebarLayoutContext.Provider>
  )
}

export function useSidebarLayout() {
  return useContext(SidebarLayoutContext)
}
