"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { clearCashierSession } from "@/lib/cashierSession"
import { getRetailPosIdleLogoutMs, isRetailPosIdleWatchPath } from "@/lib/retailPosIdleLogout"

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
  "wheel",
]

/**
 * When NEXT_PUBLIC_RETAIL_POS_IDLE_LOGOUT_MINUTES > 0, signs out after idle on /pos and /retail/pos.
 */
export default function RetailPosIdleSessionWatcher({
  pathname,
}: {
  pathname: string | null | undefined
}) {
  const router = useRouter()
  const idleMs = getRetailPosIdleLogoutMs()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastResetRef = useRef(0)

  useEffect(() => {
    if (idleMs <= 0 || !isRetailPosIdleWatchPath(pathname)) {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      return
    }

    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

    const schedule = () => {
      clearTimer()
      timerRef.current = setTimeout(async () => {
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession()
          clearCashierSession()
          await supabase.auth.signOut()
          if (session?.user) {
            router.replace("/login")
          } else {
            router.replace("/retail/pos/pin")
          }
        } catch {
          clearCashierSession()
          await supabase.auth.signOut().catch(() => {})
          router.replace("/retail/pos/pin")
        }
      }, idleMs)
    }

    const bump = () => {
      const now = Date.now()
      if (now - lastResetRef.current < 1000) return
      lastResetRef.current = now
      schedule()
    }

    bump()

    const onVisibility = () => {
      if (document.visibilityState === "visible") bump()
    }

    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, bump, { passive: true })
    }
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      clearTimer()
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, bump)
      }
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [pathname, idleMs, router])

  return null
}
