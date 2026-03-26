import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"

/**
 * Accounting workspace middleware.
 *
 * For /accounting/* and /api/accounting/*:
 *   1. Authenticate the request via the Supabase session cookie.
 *      - Unauthenticated page loads → redirect to /login?next=<path>
 *      - Unauthenticated API calls  → 401 JSON
 *   2. Inject x-workspace and x-permissions headers onto the forwarded request
 *      so that assertAccountingAccess() in route handlers can validate them
 *      without re-reading the session.
 *   3. Propagate any refreshed session cookies back to the browser.
 *
 * Actual firm-membership authorization (is this user an accounting firm member?)
 * is intentionally left to the route handlers via requireFirmMemberForApi() and
 * getAccountingAuthority(). Middleware only gates authentication, not authorization.
 *
 * Belt-and-suspenders cross-domain guard:
 *   Any request carrying x-workspace:accounting is blocked from reaching
 *   /service/* or /retail/* routes.
 */

function isAccountingPath(pathname: string): boolean {
  return pathname.startsWith("/accounting") || pathname.startsWith("/api/accounting")
}

function isServiceOrRetailPath(pathname: string): boolean {
  return (
    pathname.startsWith("/service") ||
    pathname.startsWith("/retail") ||
    pathname.startsWith("/api/service") ||
    pathname.startsWith("/api/retail")
  )
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ── Accounting path handling ────────────────────────────────────────────────
  if (isAccountingPath(pathname)) {
    // Pre-inject workspace headers onto the request that will be forwarded.
    // These are validated by assertAccountingAccess() inside each route handler.
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set("x-workspace", "accounting")
    requestHeaders.set("x-permissions", "accounting:read")

    // Build the response we intend to return. We reference this same object in
    // the Supabase SSR setAll callback so refreshed session cookies land on it.
    const response = NextResponse.next({ request: { headers: requestHeaders } })

    // Authenticate via session cookie. createServerClient here handles token
    // refresh and writes updated cookies back through the setAll callback.
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            // Forward refreshed cookies to the browser via the response.
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            )
          },
        },
      }
    )

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      // API routes: return 401 so clients can detect unauthenticated state.
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      }
      // Page routes: redirect to login, preserving the intended destination.
      const loginUrl = new URL("/login", request.url)
      loginUrl.searchParams.set("next", pathname)
      return NextResponse.redirect(loginUrl)
    }

    // User is authenticated — return the response with injected headers and
    // any refreshed session cookies.
    return response
  }

  // ── Cross-domain guard ──────────────────────────────────────────────────────
  // Prevent requests that explicitly carry x-workspace:accounting from reaching
  // Service or Retail routes. Protects against crafted API calls.
  if (
    request.headers.get("x-workspace") === "accounting" &&
    isServiceOrRetailPath(pathname)
  ) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Accounting workspace cannot access Service or Retail routes" },
        { status: 403 }
      )
    }
    return NextResponse.redirect(new URL("/unauthorized", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/accounting/:path*",
    "/api/accounting/:path*",
    "/service/:path*",
    "/retail/:path*",
    "/api/service/:path*",
    "/api/retail/:path*",
  ],
}
