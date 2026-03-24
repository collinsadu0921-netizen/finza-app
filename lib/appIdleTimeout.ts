/**
 * App-level idle session timeout.
 *
 * Authenticated users are signed out after 30 minutes of inactivity.
 * A warning modal appears 2 minutes before the deadline.
 * An absolute 12-hour session limit enforces re-auth even for active users.
 *
 * POS routes (/pos, /retail/pos/*) are excluded — those have their own
 * idle watcher (RetailPosIdleSessionWatcher).
 */

/** Inactivity duration before auto sign-out. */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

/** How long before timeout the warning modal appears. */
export const IDLE_WARNING_BEFORE_MS = 2 * 60 * 1000 // 2 minutes

/** Maximum continuous session age regardless of activity. */
export const ABSOLUTE_SESSION_MS = 12 * 60 * 60 * 1000 // 12 hours

/** localStorage key written on each activity event (fires storage event in other tabs). */
export const APP_ACTIVITY_KEY = "finza_last_activity_ts"

/**
 * sessionStorage key for the absolute session start epoch.
 * sessionStorage clears when the browser tab/window is closed, so reopening
 * the browser resets the 12-hour clock automatically.
 */
export const APP_SESSION_EPOCH_KEY = "finza_session_epoch"

/**
 * localStorage key used to broadcast a timeout to other tabs.
 * Written then immediately removed so every tab gets the storage event.
 */
export const APP_TIMEOUT_BROADCAST_KEY = "finza_session_timeout_at"

/**
 * Returns true for paths that should NOT run the app-level idle watcher
 * because they have their own session management (POS terminal).
 */
export function isExcludedFromAppIdleTimeout(
  pathname: string | null | undefined
): boolean {
  if (!pathname) return false
  const p = pathname.split("?")[0].replace(/\/$/, "") || "/"
  return (
    p === "/pos" ||
    p.startsWith("/pos/") ||
    p === "/retail/pos" ||
    p.startsWith("/retail/pos/")
  )
}
