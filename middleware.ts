import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

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

function forbidden(request: NextRequest, message: string): NextResponse {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: message }, { status: 403 })
  }
  return NextResponse.redirect(new URL("/unauthorized", request.url))
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const workspace = request.headers.get("x-workspace")

  if (isAccountingPath(pathname)) {
    if (workspace !== "accounting") {
      return forbidden(request, "Accounting workspace required")
    }

    const permissions = (request.headers.get("x-permissions") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
    if (!permissions.includes("accounting:read")) {
      return forbidden(request, "Missing accounting permission")
    }

    // Accounting requests must carry explicit context; no implicit inference.
    const businessId = request.headers.get("x-business-id")
    const teamId = request.headers.get("x-team-id")
    if (!businessId || !teamId) {
      return forbidden(request, "Missing accounting context")
    }
  }

  if (workspace === "accounting" && isServiceOrRetailPath(pathname)) {
    return forbidden(request, "Accounting workspace cannot access Service or Retail routes")
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/accounting/:path*", "/api/accounting/:path*", "/service/:path*", "/retail/:path*", "/api/service/:path*", "/api/retail/:path*"],
}
