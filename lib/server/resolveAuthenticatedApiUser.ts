/**
 * Session-first API auth — avoids Supabase Auth server rate pressure under concurrent load.
 *
 * Operational routes use a single auth read per request. Accounting API routes also pass
 * through middleware; prefer getSession() (local JWT from cookie) and only call getUser()
 * when the session is empty but a signed auth cookie is present.
 */

import type { SupabaseClient, User } from "@supabase/supabase-js"

export type AuthFailureStage =
  | "missing_cookie"
  | "get_user_failed"
  | "business_access_denied"
  | "business_context_missing"
  | "unknown"

export type ResolveAuthenticatedApiUserResult =
  | { ok: true; user: User; authSource: "session" | "get_user" }
  | { ok: false; status: 401; error: string; authFailureStage: AuthFailureStage }

const SB_AUTH_COOKIE_NAME = /sb-[a-z0-9]+-auth-token(?:\.\d+)?/i
const SB_AUTH_COOKIE_IN_HEADER = /(?:^|;\s*)sb-[a-z0-9]+-auth-token(?:\.\d+)?=/i

/** True when request carries a Supabase SSR auth cookie (no token values read). */
export function hasSupabaseAuthCookieHeader(cookieHeader: string | null | undefined): boolean {
  return SB_AUTH_COOKIE_IN_HEADER.test(String(cookieHeader ?? ""))
}

export function hasSupabaseAuthCookieNames(
  cookies: ReadonlyArray<{ name: string }>
): boolean {
  return cookies.some((c) => SB_AUTH_COOKIE_NAME.test(c.name))
}

type ResolveOpts = {
  /** Request Cookie header — used only to detect presence, never logged. */
  cookieHeader?: string | null
  /** When true (default), use getSession before optional getUser fallback. */
  preferSession?: boolean
}

/**
 * Resolve authenticated user for API routes.
 * Session-first: getSession() reads the signed cookie locally without Auth server round-trip.
 */
export async function resolveAuthenticatedApiUser(
  supabase: SupabaseClient,
  opts?: ResolveOpts
): Promise<ResolveAuthenticatedApiUserResult> {
  const preferSession = opts?.preferSession !== false
  const hasCookie = hasSupabaseAuthCookieHeader(opts?.cookieHeader)

  if (preferSession) {
    const { data: sessionData } = await supabase.auth.getSession()
    const sessionUser = sessionData.session?.user
    if (sessionUser) {
      return { ok: true, user: sessionUser, authSource: "session" }
    }
  }

  if (!hasCookie && opts?.cookieHeader !== undefined) {
    return {
      ok: false,
      status: 401,
      error: "Unauthorized",
      authFailureStage: "missing_cookie",
    }
  }

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userData.user) {
    return { ok: true, user: userData.user, authSource: "get_user" }
  }

  if (!hasCookie) {
    return {
      ok: false,
      status: 401,
      error: "Unauthorized",
      authFailureStage: "missing_cookie",
    }
  }

  if (userError) {
    console.warn("[resolveAuthenticatedApiUser] getUser failed with auth cookie present")
  }

  return {
    ok: false,
    status: 401,
    error: "Unauthorized",
    authFailureStage: "get_user_failed",
  }
}

export function authFailureStageForScopeError(status: number): AuthFailureStage {
  if (status === 403) return "business_access_denied"
  if (status === 400 || status === 404) return "business_context_missing"
  return "unknown"
}
