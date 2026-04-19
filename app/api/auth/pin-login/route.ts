import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { signCashierPosToken } from "@/lib/cashierPosToken.server"

// Service role client for database operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Rate limiting: Store failed attempts in memory (in production, use Redis)
const failedAttempts = new Map<string, { count: number; lastAttempt: number }>()

const MAX_ATTEMPTS = 5
const LOCKOUT_DURATION = 15 * 60 * 1000 // 15 minutes in milliseconds

function checkRateLimit(identifier: string): { allowed: boolean; remainingTime?: number } {
  const now = Date.now()
  const attempt = failedAttempts.get(identifier)

  if (!attempt) {
    return { allowed: true }
  }

  // Check if lockout period has passed
  if (now - attempt.lastAttempt > LOCKOUT_DURATION) {
    failedAttempts.delete(identifier)
    return { allowed: true }
  }

  // Check if max attempts reached
  if (attempt.count >= MAX_ATTEMPTS) {
    const remainingTime = Math.ceil((LOCKOUT_DURATION - (now - attempt.lastAttempt)) / 1000 / 60)
    return { allowed: false, remainingTime }
  }

  return { allowed: true }
}

function recordFailedAttempt(identifier: string) {
  const now = Date.now()
  const attempt = failedAttempts.get(identifier)

  if (attempt && now - attempt.lastAttempt < LOCKOUT_DURATION) {
    attempt.count += 1
    attempt.lastAttempt = now
  } else {
    failedAttempts.set(identifier, { count: 1, lastAttempt: now })
  }
}

function clearFailedAttempts(identifier: string) {
  failedAttempts.delete(identifier)
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { pin_code, store_id } = body

    if (!pin_code || typeof pin_code !== "string") {
      return NextResponse.json(
        { error: "PIN code is required" },
        { status: 400 }
      )
    }

    // Validate PIN format
    if (!/^\d{4,6}$/.test(pin_code)) {
      return NextResponse.json(
        { error: "Invalid PIN" },
        { status: 400 }
      )
    }

    // Rate limiting: Use IP address as identifier
    const clientIp = request.headers.get("x-forwarded-for") || 
                     request.headers.get("x-real-ip") || 
                     "unknown"
    const rateLimitCheck = checkRateLimit(clientIp)

    if (!rateLimitCheck.allowed) {
      return NextResponse.json(
        { 
          error: "Too many failed attempts. Please try again later.",
          remainingTime: rateLimitCheck.remainingTime
        },
        { status: 429 }
      )
    }

    // Find cashier by PIN and store
    // First, get all users with matching PIN
    let usersQuery = supabaseAdmin
      .from("users")
      .select(`
        id,
        full_name,
        store_id,
        pin_code
      `)
      .eq("pin_code", pin_code)
      .not("store_id", "is", null)

    // If store_id provided, filter by store
    if (store_id) {
      usersQuery = usersQuery.eq("store_id", store_id)
    }

    const { data: usersWithPin, error: pinError } = await usersQuery

    if (pinError) {
      console.error("Error querying users by PIN:", pinError)
      recordFailedAttempt(clientIp)
      return NextResponse.json(
        { error: "Invalid PIN" },
        { status: 401 }
      )
    }

    if (!usersWithPin || usersWithPin.length === 0) {
      recordFailedAttempt(clientIp)
      return NextResponse.json(
        { error: "Invalid PIN" },
        { status: 401 }
      )
    }

    // Get business_users for matching users to verify role
    // STRICT: Only cashiers can use PIN login
    const userIds = usersWithPin.map((u) => u.id)
    const { data: businessUsers, error: buError } = await supabaseAdmin
      .from("business_users")
      .select("user_id, business_id, role")
      .in("user_id", userIds)
      .eq("role", "cashier") // ONLY cashier role allowed for PIN login

    if (buError || !businessUsers || businessUsers.length === 0) {
      recordFailedAttempt(clientIp)
      return NextResponse.json(
        { error: "Invalid PIN" },
        { status: 401 }
      )
    }

    // Find the cashier that matches
    const cashierUser = usersWithPin.find((u) =>
      businessUsers.some((bu) => bu.user_id === u.id)
    )

    if (!cashierUser) {
      recordFailedAttempt(clientIp)
      return NextResponse.json(
        { error: "Invalid PIN" },
        { status: 401 }
      )
    }

    const businessUser = businessUsers.find((bu) => bu.user_id === cashierUser.id)

    // STRICT: Only cashier role can use PIN login
    if (!businessUser || businessUser.role !== "cashier") {
      recordFailedAttempt(clientIp)
      return NextResponse.json(
        { error: "PIN login is only available for cashiers. Managers and admins must use email/password login." },
        { status: 403 }
      )
    }

    // Clear failed attempts on successful login
    clearFailedAttempts(clientIp)

    const cashier_pos_token = signCashierPosToken({
      cashierId: cashierUser.id,
      businessId: businessUser.business_id,
      storeId: String(cashierUser.store_id),
    })

    // Return cashier info (without sensitive data)
    return NextResponse.json(
      {
        success: true,
        cashier: {
          id: cashierUser.id,
          name: cashierUser.full_name,
          store_id: cashierUser.store_id,
          business_id: businessUser.business_id,
        },
        ...(cashier_pos_token ? { cashier_pos_token } : {}),
      },
      { status: 200 }
    )
  } catch (error: any) {
    console.error("Error in PIN login:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
