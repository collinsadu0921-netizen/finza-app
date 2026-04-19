import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"
import { canActorCreateStaffRole } from "@/lib/staff/businessStaffPermissions"
import { createClient } from "@supabase/supabase-js"
import { randomUUID } from "node:crypto"
import { findAuthUserIdByEmail } from "@/lib/authAdminLookup"

// Service role client for admin operations (creating users)
const getSupabaseAdmin = () => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for creating system users")
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

export async function POST(request: NextRequest) {
  try {
    console.log("Creating system user - starting...")

    // Check service role key early
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.error("SUPABASE_SERVICE_ROLE_KEY is not set")
      return NextResponse.json(
        { error: "Service role key is required for creating system users" },
        { status: 500 }
      )
    }

    console.log("Service role key found, creating clients...")
    const supabaseAdmin = getSupabaseAdmin()
    const supabase = await createSupabaseServerClient()

    console.log("Getting user...")
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      console.error("No user found in session")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    console.log("Getting business for user:", user.id)
    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      console.error("Business not found for user:", user.id)
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    console.log("Business found:", business.id)

    const actorRole = await getUserRole(supabase, user.id, business.id)
    if (!actorRole || actorRole === "cashier") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    let body
    try {
      body = await request.json()
    } catch (parseError: any) {
      console.error("Failed to parse request body:", parseError)
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      )
    }

    const {
      name,
      email,
      password,
      role,
      store_id,
      pin_code,
      auto_generate_password,
    } = body

    console.log("Request body parsed:", { role, name, hasStoreId: !!store_id, hasPinCode: !!pin_code })

    // Validate role
    if (!role || !["admin", "manager", "cashier"].includes(role)) {
      console.error("Invalid role:", role)
      return NextResponse.json(
        { error: "Invalid role. Must be admin, manager, or cashier." },
        { status: 400 }
      )
    }

    if (!canActorCreateStaffRole(actorRole, role)) {
      return NextResponse.json(
        { error: "Forbidden: your role cannot create this staff type." },
        { status: 403 }
      )
    }

    // Validate name
    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      )
    }

    // Admin/Manager: Require email and password
    if (role === "admin" || role === "manager") {
      if (!email || !email.trim()) {
        return NextResponse.json(
          { error: "Email is required for admin and manager roles" },
          { status: 400 }
        )
      }

      // Check email uniqueness
      const { data: existingUser } = await supabaseAdmin
        .from("users")
        .select("id")
        .eq("email", email.trim().toLowerCase())
        .maybeSingle()

      if (existingUser) {
        return NextResponse.json(
          { error: "Email already exists" },
          { status: 400 }
        )
      }

      const authIdForEmail = await findAuthUserIdByEmail(supabaseAdmin, email.trim().toLowerCase())
      if (authIdForEmail) {
        return NextResponse.json(
          { error: "Email already exists" },
          { status: 400 }
        )
      }

      // Generate password if auto-generate is requested
      let finalPassword = password
      if (auto_generate_password) {
        // Generate a random password
        finalPassword = Math.random().toString(36).slice(-12) + Math.random().toString(36).slice(-12).toUpperCase() + "!@#"
      }

      if (!finalPassword || finalPassword.length < 6) {
        return NextResponse.json(
          { error: "Password is required and must be at least 6 characters" },
          { status: 400 }
        )
      }

      // Create user in Supabase Auth
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: email.trim().toLowerCase(),
        password: finalPassword,
        email_confirm: true,
        user_metadata: {
          full_name: name.trim(),
        },
      })

      if (authError) {
        return NextResponse.json(
          { error: authError.message || "Failed to create user account" },
          { status: 500 }
        )
      }

      if (!authData.user) {
        return NextResponse.json(
          { error: "Failed to create user account" },
          { status: 500 }
        )
      }

      // Create user record in users table
      const userData: any = {
        id: authData.user.id,
        email: email.trim().toLowerCase(),
        full_name: name.trim(),
        store_id: store_id || null,
      }

      const { data: userRecord, error: userError } = await supabaseAdmin
        .from("users")
        .insert(userData)
        .select()
        .single()

      if (userError) {
        console.error("Error creating user record:", {
          error: userError,
          message: userError.message,
          code: userError.code,
          details: userError.details,
          hint: userError.hint,
          userData: userData,
        })
        // Rollback: delete auth user if user record creation fails
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
        return NextResponse.json(
          { error: userError.message || "Failed to create user record", details: userError.details, code: userError.code },
          { status: 500 }
        )
      }

      // Create business_users record
      const { error: businessUserError } = await supabaseAdmin
        .from("business_users")
        .insert({
          business_id: business.id,
          user_id: authData.user.id,
          role: role,
        })

      if (businessUserError) {
        console.error("Error creating business_users record:", {
          error: businessUserError,
          message: businessUserError.message,
          code: businessUserError.code,
          details: businessUserError.details,
          hint: businessUserError.hint,
          business_id: business.id,
          user_id: authData.user.id,
          role: role,
        })
        // Rollback: delete user record and auth user
        await supabaseAdmin.from("users").delete().eq("id", authData.user.id)
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id)
        return NextResponse.json(
          { error: businessUserError.message || "Failed to assign user to business", details: businessUserError.details, code: businessUserError.code },
          { status: 500 }
        )
      }

      return NextResponse.json(
        {
          success: true,
          user: userRecord,
          password: auto_generate_password ? finalPassword : undefined,
        },
        { status: 201 }
      )
    }

    // Cashier: Require PIN and store, no email/password
    if (role === "cashier") {
      console.log("Processing cashier creation...")
      if (!store_id) {
        console.error("Store ID is missing for cashier")
        return NextResponse.json(
          { error: "Store assignment is required for cashiers" },
          { status: 400 }
        )
      }

      if (!pin_code || pin_code.length < 4 || pin_code.length > 6) {
        return NextResponse.json(
          { error: "PIN code is required and must be 4-6 digits" },
          { status: 400 }
        )
      }

      // Validate PIN is numeric
      if (!/^\d+$/.test(pin_code)) {
        return NextResponse.json(
          { error: "PIN code must contain only digits" },
          { status: 400 }
        )
      }

      // Check PIN uniqueness per store (only if pin_code column exists)
      try {
        const { data: existingPin, error: pinCheckError } = await supabaseAdmin
          .from("users")
          .select("id")
          .eq("store_id", store_id)
          .eq("pin_code", pin_code)
          .maybeSingle()

        if (pinCheckError && pinCheckError.code !== "42703") {
          // Column doesn't exist error is OK, we'll create it
          // Other errors should be reported
          return NextResponse.json(
            { error: pinCheckError.message || "Failed to check PIN uniqueness" },
            { status: 500 }
          )
        }

        if (existingPin) {
          return NextResponse.json(
            { error: "PIN code already exists for this store" },
            { status: 400 }
          )
        }
      } catch (err: any) {
        // If column doesn't exist, that's OK - we'll add it when inserting
        if (!err.message?.includes("pin_code") && err.code !== "42703") {
          return NextResponse.json(
            { error: "Failed to validate PIN code" },
            { status: 500 }
          )
        }
      }

      // Verify store exists
      const { data: store } = await supabaseAdmin
        .from("stores")
        .select("id")
        .eq("id", store_id)
        .eq("business_id", business.id)
        .maybeSingle()

      if (!store) {
        return NextResponse.json(
          { error: "Store not found" },
          { status: 404 }
        )
      }

      // Create user record without auth (cashiers don't have email/password)
      // Generate a UUID for the user ID
      const userId = randomUUID()
      console.log("Generated user ID for cashier:", userId)

      const userData: any = {
        id: userId,
        email: null,
        full_name: name.trim(),
        store_id: store_id,
        pin_code: pin_code,
      }

      // Try to insert with pin_code
      const { data: userRecord, error: userError } = await supabaseAdmin
        .from("users")
        .insert(userData)
        .select()
        .single()

      if (userError) {
        console.error("Error creating cashier user record:", {
          error: userError,
          message: userError.message,
          code: userError.code,
          details: userError.details,
          hint: userError.hint,
          userData: userData,
        })
        
        // If pin_code column doesn't exist, try without it
        if (userError.message?.includes("pin_code") || userError.code === "42703") {
          console.log("pin_code column not found, retrying without it...")
          delete userData.pin_code
          const { data: userRecordRetry, error: userErrorRetry } = await supabaseAdmin
            .from("users")
            .insert(userData)
            .select()
            .single()

          if (userErrorRetry) {
            console.error("Error creating user record (retry without pin_code):", {
              error: userErrorRetry,
              message: userErrorRetry.message,
              code: userErrorRetry.code,
              details: userErrorRetry.details,
            })
            return NextResponse.json(
              { error: userErrorRetry.message || "Failed to create user record", details: userErrorRetry.details, code: userErrorRetry.code },
              { status: 500 }
            )
          }

          // Return with warning about missing column
          return NextResponse.json(
            {
              success: true,
              user: userRecordRetry,
              warning: "PIN code column not found. Please run migration 068_add_pin_code_to_users.sql",
            },
            { status: 201 }
          )
        }

        return NextResponse.json(
          { error: userError.message || "Failed to create user record", details: userError.details, code: userError.code },
          { status: 500 }
        )
      }

      if (!userRecord) {
        return NextResponse.json(
          { error: "Failed to create user record" },
          { status: 500 }
        )
      }

      // Create business_users record
      const { error: businessUserError } = await supabaseAdmin
        .from("business_users")
        .insert({
          business_id: business.id,
          user_id: userId,
          role: "cashier",
        })

      if (businessUserError) {
        console.error("Error creating business_users record for cashier:", {
          error: businessUserError,
          message: businessUserError.message,
          code: businessUserError.code,
          details: businessUserError.details,
          hint: businessUserError.hint,
          business_id: business.id,
          user_id: userId,
          role: "cashier",
        })
        // Rollback: delete user record
        await supabaseAdmin.from("users").delete().eq("id", userId)
        return NextResponse.json(
          { error: businessUserError.message || "Failed to assign user to business", details: businessUserError.details, code: businessUserError.code },
          { status: 500 }
        )
      }

      return NextResponse.json(
        {
          success: true,
          user: userRecord,
        },
        { status: 201 }
      )
    }

    return NextResponse.json(
      { error: "Invalid role" },
      { status: 400 }
    )
  } catch (error) {
    // Outer catch for unexpected errors
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = error as any
    console.error("Unexpected error creating system user:", {
      message: err?.message,
      stack: err?.stack,
      name: err?.name,
      code: err?.code,
      details: err?.details,
      hint: err?.hint,
      error: err,
    })

    const errorMessage = error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : "Internal server error"

    return NextResponse.json(
      { error: errorMessage, details: err?.details, code: err?.code },
      { status: 500 }
    )
  }
}

