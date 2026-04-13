/**
 * Base URL for Supabase auth redirects (reset password, email confirm).
 * Prefer the current browser origin on the client so dev/prod hosts match the link.
 */
export function getPublicAppUrl(): string {
  if (typeof window !== "undefined") {
    return window.location.origin.replace(/\/$/, "")
  }
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "")
  return env || "http://localhost:3000"
}
