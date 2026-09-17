import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"
import { createClient } from "@supabase/supabase-js"
import { getUserRole } from "@/lib/userRoles"
import {
  POS_TERMINAL_LOCK_COOKIE,
  posTerminalLockCookieOptions,
  readPosTerminalLockClaimsFromRequest,
  signPosTerminalLockToken,
} from "@/lib/retail/posTerminalLockToken"

function createRouteSupabase(request: NextRequest, response: NextResponse) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )
}

function isPrivilegedRetailRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin" || role === "manager"
}

/**
 * Activate (or refresh) the HttpOnly terminal lock cookie.
 * Requires an authenticated owner/admin/manager for the given business.
 */
export async function POST(request: NextRequest) {
  const response = new NextResponse()
  try {
    const body = (await request.json().catch(() => null)) as {
      businessId?: string
      storeId?: string
      registerId?: string | null
    } | null

    const businessId = typeof body?.businessId === "string" ? body.businessId.trim() : ""
    const storeId = typeof body?.storeId === "string" ? body.storeId.trim() : ""
    const registerId =
      typeof body?.registerId === "string" && body.registerId.trim()
        ? body.registerId.trim()
        : null

    if (!businessId || !storeId) {
      return NextResponse.json({ error: "businessId and storeId are required" }, { status: 400 })
    }

    const supabase = createRouteSupabase(request, response)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const role = await getUserRole(supabase, user.id, businessId)
    if (!isPrivilegedRetailRole(role)) {
      return NextResponse.json(
        { error: "Only owner, admin, or manager can activate terminal cashier mode" },
        { status: 403 }
      )
    }

    const token = await signPosTerminalLockToken({ businessId, storeId, registerId })
    if (!token) {
      return NextResponse.json({ error: "Terminal lock signing unavailable" }, { status: 503 })
    }

    const out = NextResponse.json({ ok: true, businessId, storeId, registerId })
    // Copy any refreshed auth cookies from the working response
    response.cookies.getAll().forEach((c) => {
      out.cookies.set(c.name, c.value)
    })
    out.cookies.set(POS_TERMINAL_LOCK_COOKIE, token, posTerminalLockCookieOptions(12 * 3600))
    return out
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

/**
 * Release terminal lock after owner/admin/manager email+password reauthentication.
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      email?: string
      password?: string
    } | null

    const email = typeof body?.email === "string" ? body.email.trim() : ""
    const password = typeof body?.password === "string" ? body.password : ""
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 })
    }

    const claims = await readPosTerminalLockClaimsFromRequest(request)
    const businessId = claims?.businessId ?? null

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anon) {
      return NextResponse.json({ error: "Auth unavailable" }, { status: 503 })
    }

    const authClient = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
      email,
      password,
    })
    if (authError || !authData.user) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 })
    }

    if (businessId) {
      const adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (!adminKey) {
        return NextResponse.json({ error: "Service unavailable" }, { status: 503 })
      }
      const admin = createClient(url, adminKey)
      const role = await getUserRole(admin, authData.user.id, businessId)
      if (!isPrivilegedRetailRole(role)) {
        return NextResponse.json(
          { error: "Account is not authorized to unlock this terminal" },
          { status: 403 }
        )
      }
    } else {
      const adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY
      if (adminKey) {
        const admin = createClient(url, adminKey)
        const { data: memberships } = await admin
          .from("business_users")
          .select("role, business_id")
          .eq("user_id", authData.user.id)
          .in("role", ["owner", "admin", "manager"])
          .limit(1)
        const { data: owned } = await admin
          .from("businesses")
          .select("id")
          .eq("owner_id", authData.user.id)
          .limit(1)
        if ((!memberships || memberships.length === 0) && (!owned || owned.length === 0)) {
          return NextResponse.json(
            { error: "Account is not authorized to unlock this terminal" },
            { status: 403 }
          )
        }
      }
    }

    const response = NextResponse.json({ ok: true })
    response.cookies.set(POS_TERMINAL_LOCK_COOKIE, "", {
      ...posTerminalLockCookieOptions(0),
      maxAge: 0,
    })
    return response
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
