import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { createClient } from "@supabase/supabase-js"
import { randomBytes } from "node:crypto"
import { hasPermission, type CustomPermissions } from "@/lib/permissions"
import type { SupabaseClient } from "@supabase/supabase-js"

const VALID_ROLES = ["admin", "manager", "accountant", "staff"]

async function getCallerPermissions(
  supabase: SupabaseClient,
  businessId: string,
  userId: string,
  ownerId: string
): Promise<{ role: string; customPermissions: CustomPermissions | null } | null> {
  if (userId === ownerId) return { role: "owner", customPermissions: null }
  const { data } = await supabase
    .from("business_users")
    .select("role, custom_permissions")
    .eq("business_id", businessId)
    .eq("user_id", userId)
    .maybeSingle()
  if (!data) return null
  return { role: data.role, customPermissions: (data.custom_permissions as CustomPermissions) ?? null }
}

function getSupabaseAdmin() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required")
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// ── GET /api/service/team ─────────────────────────────────────────────────────
// List all team members for the current business
export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 })

    // Check caller has team.manage permission (respects custom_permissions overrides)
    const caller = await getCallerPermissions(supabase, business.id, user.id, business.owner_id)
    if (!caller || !hasPermission(caller.role, caller.customPermissions, "team.manage")) {
      return NextResponse.json({ error: "Forbidden: requires team.manage permission" }, { status: 403 })
    }

    const { data: members, error } = await supabase
      .from("business_users")
      .select("id, user_id, role, display_name, email, invited_at, created_at, custom_permissions")
      .eq("business_id", business.id)
      .order("created_at", { ascending: true })

    if (error) throw error

    return NextResponse.json({ members: members ?? [] })
  } catch (err: any) {
    console.error("GET /api/service/team error:", err)
    return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 })
  }
}

// ── POST /api/service/team ────────────────────────────────────────────────────
// Invite a new team member (creates auth user if not exists, adds to business_users)
export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 })

    // Inviting requires team.manage permission
    const caller = await getCallerPermissions(supabase, business.id, user.id, business.owner_id)
    if (!caller || !hasPermission(caller.role, caller.customPermissions, "team.manage")) {
      return NextResponse.json({ error: "Forbidden: requires team.manage permission" }, { status: 403 })
    }

    const body = await request.json()
    const { email, display_name, role, password, auto_generate_password } = body

    if (!email?.trim()) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 })
    }
    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: `Role must be one of: ${VALID_ROLES.join(", ")}` }, { status: 400 })
    }

    const supabaseAdmin = getSupabaseAdmin()

    // Check if a Supabase auth user with this email already exists
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers()
    const existingAuthUser = existingUsers?.users?.find(
      (u: any) => u.email?.toLowerCase() === email.toLowerCase().trim()
    )

    let targetUserId: string

    if (existingAuthUser) {
      // User already has a Finza account — just add them to this business
      targetUserId = existingAuthUser.id

      // Check if they're already a member
      const { data: existing } = await supabase
        .from("business_users")
        .select("id, role")
        .eq("business_id", business.id)
        .eq("user_id", targetUserId)
        .maybeSingle()

      if (existing) {
        return NextResponse.json({
          error: "This user is already a member of this workspace",
        }, { status: 409 })
      }
    } else {
      // Create a new Supabase auth user
      const generatedPassword = auto_generate_password
        ? randomBytes(8).toString("hex")
        : password

      if (!generatedPassword || generatedPassword.length < 6) {
        return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 })
      }

      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: email.trim(),
        password: generatedPassword,
        email_confirm: true,
        user_metadata: { full_name: display_name || email.split("@")[0] },
      })

      if (createError || !newUser?.user) {
        return NextResponse.json({ error: createError?.message || "Failed to create user" }, { status: 400 })
      }
      targetUserId = newUser.user.id
    }

    // Add to business_users
    const { data: memberRow, error: insertError } = await supabase
      .from("business_users")
      .insert({
        business_id: business.id,
        user_id: targetUserId,
        role,
        display_name: display_name || email.split("@")[0],
        email: email.trim().toLowerCase(),
        invited_by: user.id,
        invited_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (insertError) throw insertError

    return NextResponse.json({
      success: true,
      member: memberRow,
      isExistingUser: !!existingAuthUser,
    })
  } catch (err: any) {
    console.error("POST /api/service/team error:", err)
    return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 })
  }
}
