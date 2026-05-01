import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { createClient } from "@supabase/supabase-js"
import { randomBytes } from "node:crypto"
import { hasPermission, type CustomPermissions } from "@/lib/permissions"
import type { SupabaseClient } from "@supabase/supabase-js"
import { logAudit } from "@/lib/auditLog"
import { findAuthUserIdByEmail, isLikelyDuplicateAuthUserError } from "@/lib/authAdminLookup"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"

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

    const subDenied = await enforceServiceWorkspaceAccess({
      supabase,
      userId: user.id,
      businessId: business.id,
      minTier: "starter",
    })
    if (subDenied) return subDenied

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

    const subDenied = await enforceServiceWorkspaceAccess({
      supabase,
      userId: user.id,
      businessId: business.id,
      minTier: "starter",
    })
    if (subDenied) return subDenied

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
    const normalizedEmail = email.trim().toLowerCase()

    let targetUserId = await findAuthUserIdByEmail(supabaseAdmin, normalizedEmail)
    let isExistingUser = !!targetUserId

    if (!targetUserId) {
      const generatedPassword = auto_generate_password
        ? randomBytes(8).toString("hex")
        : password

      if (!generatedPassword || generatedPassword.length < 6) {
        return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 })
      }

      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: normalizedEmail,
        password: generatedPassword,
        email_confirm: true,
        user_metadata: { full_name: display_name || email.split("@")[0] },
      })

      if (createError || !newUser?.user?.id) {
        if (createError && isLikelyDuplicateAuthUserError(createError.message)) {
          targetUserId = await findAuthUserIdByEmail(supabaseAdmin, normalizedEmail)
          if (!targetUserId) {
            return NextResponse.json(
              {
                error:
                  "An account with this email already exists, but it could not be loaded. Try again in a moment or contact support if this persists.",
              },
              { status: 409 }
            )
          }
          isExistingUser = true
        } else {
          return NextResponse.json(
            { error: createError?.message || "Failed to create user" },
            { status: 400 }
          )
        }
      } else {
        targetUserId = newUser.user.id
        isExistingUser = false
      }
    }

    if (!targetUserId) {
      return NextResponse.json({ error: "Could not resolve the invited user account." }, { status: 500 })
    }

    const { data: verified, error: verifyErr } = await supabaseAdmin.auth.admin.getUserById(targetUserId)
    if (verifyErr || !verified?.user?.id) {
      return NextResponse.json(
        { error: "Could not verify the invited user's login account in Auth. Check Supabase configuration and try again." },
        { status: 502 }
      )
    }

    const { data: existingMember } = await supabaseAdmin
      .from("business_users")
      .select("id, role")
      .eq("business_id", business.id)
      .eq("user_id", targetUserId)
      .maybeSingle()

    if (existingMember) {
      return NextResponse.json(
        { error: "This user is already a member of this workspace" },
        { status: 409 }
      )
    }

    const { data: memberRow, error: insertError } = await supabaseAdmin
      .from("business_users")
      .insert({
        business_id: business.id,
        user_id: targetUserId,
        role,
        display_name: display_name || email.split("@")[0],
        email: normalizedEmail,
        invited_by: user.id,
        invited_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (insertError) throw insertError

    await logAudit({
      businessId: business.id,
      userId: user.id,
      actionType: "team.member_invited",
      entityType: "team_member",
      entityId: memberRow.id,
      newValues: {
        email: normalizedEmail,
        role,
        display_name: display_name || null,
        is_existing_user: isExistingUser,
      },
      description: `Invited ${normalizedEmail} as ${role}`,
      request,
    })

    return NextResponse.json({
      success: true,
      member: memberRow,
      isExistingUser,
    })
  } catch (err: any) {
    console.error("POST /api/service/team error:", err)
    return NextResponse.json({ error: err.message || "Internal error" }, { status: 500 })
  }
}
