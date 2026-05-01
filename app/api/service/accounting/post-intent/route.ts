/**
 * POST /api/service/accounting/post-intent
 *
 * Service workspace only. Posts to ledger via intent (engine-controlled debit/credit).
 * Authorized: checkAccountingAuthority(..., "write").
 * Does not touch accounting workspace or firm workflow.
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"
import {
  type ServiceIntent,
  validateServiceIntent,
  type AccountForValidation,
} from "@/lib/service/accounting/intentTypes"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      )
    }

    const businessId = body.business_id as string | undefined
    if (!businessId || typeof businessId !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid business_id" },
        { status: 400 }
      )
    }

    const denied = await enforceServiceWorkspaceAccess({
      supabase,
      userId: user.id,
      businessId,
      minTier: "business",
    })
    if (denied) return denied

    const auth = await checkAccountingAuthority(supabase, user.id, businessId, "write")
    if (!auth.authorized) {
      return NextResponse.json(
        { error: "You do not have write access to this business" },
        { status: 403 }
      )
    }

    const intent = body.intent as ServiceIntent
    if (!intent || typeof intent !== "object" || !intent.intent_type) {
      return NextResponse.json(
        { error: "Missing or invalid intent" },
        { status: 400 }
      )
    }

    const { data: accounts, error: accountsError } = await supabase
      .from("accounts")
      .select("id, type, sub_type")
      .eq("business_id", businessId)
      .is("deleted_at", null)

    if (accountsError) {
      console.error("post-intent fetch accounts:", accountsError)
      return NextResponse.json(
        { error: "Failed to load accounts" },
        { status: 500 }
      )
    }

    const accountList = (accounts || []) as AccountForValidation[]
    const validationError = validateServiceIntent(intent, accountList)
    if (validationError) {
      return NextResponse.json(
        { error: validationError },
        { status: 400 }
      )
    }

    const { data: journalEntryId, error: rpcError } = await supabase.rpc(
      "post_service_intent_to_ledger",
      {
        p_business_id: businessId,
        p_user_id: user.id,
        p_entry_date: intent.entry_date,
        p_intent: intent,
      }
    )

    if (rpcError) {
      console.error("post_service_intent_to_ledger error:", rpcError)
      const msg = rpcError.message || "Failed to post to ledger"
      if (msg.includes("locked") || msg.includes("period")) {
        return NextResponse.json(
          { error: "Cannot post to a locked period. Choose another date." },
          { status: 400 }
        )
      }
      if (msg.includes("Unauthorized") || msg.includes("authorized")) {
        return NextResponse.json(
          { error: msg },
          { status: 403 }
        )
      }
      return NextResponse.json(
        { error: msg },
        { status: 500 }
      )
    }

    if (!journalEntryId) {
      return NextResponse.json(
        { error: "Posting did not return a journal entry" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      journal_entry_id: journalEntryId,
    })
  } catch (error: unknown) {
    console.error("post-intent error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    )
  }
}
