"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { clearTabIndustryMode } from "@/lib/industryMode"
import { clearSelectedBusinessId } from "@/lib/business"
import {
  IDLE_TIMEOUT_MS,
  IDLE_WARNING_BEFORE_MS,
  ABSOLUTE_SESSION_MS,
  APP_ACTIVITY_KEY,
  APP_SESSION_EPOCH_KEY,
  APP_TIMEOUT_BROADCAST_KEY,
  isExcludedFromAppIdleTimeout,
} from "@/lib/appIdleTimeout"

const WARNING_AT_MS = IDLE_TIMEOUT_MS - IDLE_WARNING_BEFORE_MS // 28 minutes
const DEBOUNCE_MS = 1000

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  "mousemove",
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
]

/**
 * Mounts once inside ProtectedLayout. Tracks user inactivity globally and:
 * - Shows a warning modal 2 minutes before the 30-minute idle deadline.
 * - Signs the user out and redirects to /login on timeout.
 * - Enforces an absolute 12-hour session limit (via sessionStorage epoch).
 * - Syncs activity and timeout events across tabs via localStorage events.
 *
 * POS paths are excluded — those use RetailPosIdleSessionWatcher.
 */
export default function AppIdleTimeoutWatcher({
  pathname,
}: {
  pathname: string | null | undefined
}) {
  const router = useRouter()
  const [showWarning, setShowWarning] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(
    Math.floor(IDLE_WARNING_BEFORE_MS / 1000)
  )

  // Stable refs that expose the latest stay/sign-out handlers to JSX.
  // Updated inside useEffect so JSX button callbacks are never stale.
  const stayRef = useRef<() => void>(() => {})
  const signOutRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    if (isExcludedFromAppIdleTimeout(pathname)) {
      // Clear any warning that may have been showing before navigating to POS.
      setShowWarning(false)
      return
    }

    // --- Absolute session epoch ------------------------------------------------
    // Stored in sessionStorage so it resets when the user closes the browser.
    try {
      if (!sessionStorage.getItem(APP_SESSION_EPOCH_KEY)) {
        sessionStorage.setItem(APP_SESSION_EPOCH_KEY, String(Date.now()))
      }
    } catch {
      // sessionStorage unavailable (private-browsing edge cases) — ignore.
    }

    // --- Mutable state local to this effect run --------------------------------
    let signingOut = false
    let lastReset = 0

    const warnTimer = { current: null as ReturnType<typeof setTimeout> | null }
    const logoutTimer = { current: null as ReturnType<typeof setTimeout> | null }
    const countdownTimer = { current: null as ReturnType<typeof setInterval> | null }

    function clearAllTimers() {
      if (warnTimer.current) {
        clearTimeout(warnTimer.current)
        warnTimer.current = null
      }
      if (logoutTimer.current) {
        clearTimeout(logoutTimer.current)
        logoutTimer.current = null
      }
      if (countdownTimer.current) {
        clearInterval(countdownTimer.current)
        countdownTimer.current = null
      }
    }

    async function doSignOut() {
      if (signingOut) return
      signingOut = true

      clearAllTimers()
      setShowWarning(false)

      // Clear absolute session epoch.
      try {
        sessionStorage.removeItem(APP_SESSION_EPOCH_KEY)
      } catch {}

      // Broadcast timeout to other open tabs before clearing local state.
      try {
        localStorage.setItem(APP_TIMEOUT_BROADCAST_KEY, String(Date.now()))
        localStorage.removeItem(APP_TIMEOUT_BROADCAST_KEY)
      } catch {}

      clearTabIndustryMode()
      clearSelectedBusinessId()

      try {
        await supabase.auth.signOut()
      } catch {}

      router.replace("/login")
    }

    function schedule() {
      clearAllTimers()
      setShowWarning(false)
      setSecondsLeft(Math.floor(IDLE_WARNING_BEFORE_MS / 1000))

      // Show warning modal 2 minutes before forced logout.
      warnTimer.current = setTimeout(() => {
        setShowWarning(true)
        setSecondsLeft(Math.floor(IDLE_WARNING_BEFORE_MS / 1000))

        countdownTimer.current = setInterval(() => {
          setSecondsLeft((s) => {
            if (s <= 1) {
              if (countdownTimer.current) {
                clearInterval(countdownTimer.current)
                countdownTimer.current = null
              }
              return 0
            }
            return s - 1
          })
        }, 1000)
      }, WARNING_AT_MS)

      // Force logout at the full 30-minute mark.
      logoutTimer.current = setTimeout(() => {
        void doSignOut()
      }, IDLE_TIMEOUT_MS)
    }

    function staySignedIn() {
      const now = Date.now()
      lastReset = now
      // Broadcast activity to other tabs (storage event fires only in other tabs).
      try {
        localStorage.setItem(APP_ACTIVITY_KEY, String(now))
      } catch {}
      schedule()
    }

    function bump() {
      const now = Date.now()
      if (now - lastReset < DEBOUNCE_MS) return
      lastReset = now

      // Enforce absolute session age regardless of activity.
      try {
        const epochStr = sessionStorage.getItem(APP_SESSION_EPOCH_KEY)
        if (epochStr) {
          const epoch = Number(epochStr)
          if (Number.isFinite(epoch) && now - epoch >= ABSOLUTE_SESSION_MS) {
            void doSignOut()
            return
          }
        }
      } catch {}

      // Broadcast activity to other tabs.
      try {
        localStorage.setItem(APP_ACTIVITY_KEY, String(now))
      } catch {}

      schedule()
    }

    // Expose to JSX via refs so buttons never hold stale closures.
    stayRef.current = staySignedIn
    signOutRef.current = doSignOut

    // Start the initial idle timer.
    schedule()

    // --- Activity listeners ----------------------------------------------------
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, bump, { passive: true })
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") bump()
    }
    document.addEventListener("visibilitychange", onVisibility)

    // --- Cross-tab sync via localStorage storage event ------------------------
    // NOTE: storage events only fire in tabs OTHER than the one that wrote.
    const onStorage = (e: StorageEvent) => {
      if (e.key === APP_ACTIVITY_KEY && e.newValue) {
        // Activity in another tab — reset our idle timer without re-broadcasting.
        lastReset = Date.now()
        schedule()
      }
      if (e.key === APP_TIMEOUT_BROADCAST_KEY && e.newValue) {
        // Another tab timed out — sign out this tab too.
        void doSignOut()
      }
    }
    window.addEventListener("storage", onStorage)

    return () => {
      clearAllTimers()
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, bump)
      }
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("storage", onStorage)
      // Nullify refs so stale JSX callbacks are safely no-ops after unmount.
      stayRef.current = () => {}
      signOutRef.current = async () => {}
    }
  }, [pathname, router])
  // router is stable in Next.js App Router.
  // pathname change = navigation = user activity, so re-running is intentional.

  if (isExcludedFromAppIdleTimeout(pathname) || !showWarning) return null

  const minutes = Math.floor(secondsLeft / 60)
  const seconds = String(secondsLeft % 60).padStart(2, "0")

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-warning-title"
      aria-describedby="session-warning-desc"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        aria-hidden="true"
      />

      {/* Dialog panel */}
      <div className="relative w-full max-w-md rounded-xl bg-white shadow-xl dark:bg-gray-800">
        <div className="p-6">
          {/* Icon + heading */}
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 rounded-full bg-amber-100 p-2.5 dark:bg-amber-900/30">
              <svg
                className="h-5 w-5 text-amber-600 dark:text-amber-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <h2
                id="session-warning-title"
                className="text-base font-semibold text-gray-900 dark:text-white"
              >
                Session expiring soon
              </h2>
              <p
                id="session-warning-desc"
                className="mt-1 text-sm text-gray-500 dark:text-gray-400"
              >
                You&apos;ll be signed out due to inactivity in{" "}
                <span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                  {minutes}:{seconds}
                </span>
                . Click <strong className="text-gray-700 dark:text-gray-200">Stay signed in</strong> to continue.
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => void signOutRef.current()}
              className="order-2 sm:order-1 rounded-lg border border-gray-200 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
            >
              Log out now
            </button>
            <button
              type="button"
              onClick={() => stayRef.current()}
              className="order-1 sm:order-2 rounded-lg bg-slate-800 dark:bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:hover:bg-slate-600 transition-colors"
            >
              Stay signed in
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
