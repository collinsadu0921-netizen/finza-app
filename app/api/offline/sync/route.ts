import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { createClient as createServerClient } from "@/lib/supabaseServer"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

type OfflineTransaction = {
  local_id: string
  business_id: string
  store_id: string
  register_id: string
  cashier_id: string
  type: "sale" | "refund" | "void"
  payload: any // Full sale/refund/void payload
  entry_date: string // ISO timestamp
}

/**
 * POST /api/offline/sync
 * 
 * Syncs pending offline transactions to the server.
 * Processes transactions in FIFO order (by created_at).
 * 
 * Flow:
 * 1. Validate each transaction (idempotency, period status)
 * 2. Insert into offline_transactions (pending status)
 * 3. Call /api/sales/create internally with entry_date and X-Offline-Sync header
 * 4. Update offline_transactions status (synced/failed)
 * 
 * Guardrails:
 * - Idempotent: duplicate local_id is rejected
 * - Period locking: HARD_LOCKED periods reject transactions
 * - FIFO order: transactions processed in chronological order
 * - No reordering: transactions maintain original order
 */
export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const supabaseServer = createServerClient()
    const {
      data: { user },
      error: authError,
    } = await supabaseServer.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { transactions } = body as { transactions: OfflineTransaction[] }

    if (!Array.isArray(transactions) || transactions.length === 0) {
      return NextResponse.json(
        { error: "transactions array is required and must not be empty" },
        { status: 400 }
      )
    }

    // Sort transactions by entry_date (FIFO order)
    const sortedTransactions = [...transactions].sort(
      (a, b) => new Date(a.entry_date).getTime() - new Date(b.entry_date).getTime()
    )

    const results: Array<{
      local_id: string
      status: "synced" | "failed"
      sale_id?: string
      error?: string
    }> = []

    // Get absolute URL for internal fetch
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
    const cookieHeader = request.headers.get("cookie") || ""

    // Process each transaction in order
    for (const tx of sortedTransactions) {
      try {
        // 1. Idempotency check: Has this local_id been seen before?
        const { data: existingTx } = await supabase
          .from("offline_transactions")
          .select("id, status, canonical_sale_id")
          .eq("local_id", tx.local_id)
          .maybeSingle()

        if (existingTx) {
          if (existingTx.status === "synced" && existingTx.canonical_sale_id) {
            // Already synced - return success
            results.push({
              local_id: tx.local_id,
              status: "synced",
              sale_id: existingTx.canonical_sale_id,
            })
            continue
          } else if (existingTx.status === "pending") {
            // Already queued but not synced - mark as failed (duplicate)
            await supabase
              .from("offline_transactions")
              .update({
                status: "failed",
                error_message: "Duplicate local_id detected during sync",
              })
              .eq("id", existingTx.id)

            results.push({
              local_id: tx.local_id,
              status: "failed",
              error: "Duplicate local_id detected",
            })
            continue
          }
        }

        // 2. Validate entry_date against accounting period
        // Check if period is locked (blocks posting)
        const entryDate = new Date(tx.entry_date)
        const entryDateStr = entryDate.toISOString().split("T")[0]
        const { data: period } = await supabase
          .from("accounting_periods")
          .select("id, status")
          .eq("business_id", tx.business_id)
          .lte("period_start", entryDateStr) // period_start <= entryDate
          .gte("period_end", entryDateStr)   // period_end >= entryDate
          .maybeSingle()

        if (period && period.status === "locked") {
          // Period is locked - reject transaction
          const { data: insertedTx } = await supabase
            .from("offline_transactions")
            .insert({
              local_id: tx.local_id,
              business_id: tx.business_id,
              store_id: tx.store_id,
              register_id: tx.register_id,
              cashier_id: tx.cashier_id,
              type: tx.type,
              payload: tx.payload,
              entry_date: tx.entry_date,
              status: "failed",
              error_message: `Accounting period is locked. Cannot post transaction dated ${entryDate.toISOString().split("T")[0]}.`,
            })
            .select()
            .single()

          results.push({
            local_id: tx.local_id,
            status: "failed",
            error: "Accounting period is locked",
          })
          continue
        }

        // 3. Insert into offline_transactions (pending status)
        const { data: insertedTx, error: insertError } = await supabase
          .from("offline_transactions")
          .insert({
            local_id: tx.local_id,
            business_id: tx.business_id,
            store_id: tx.store_id,
            register_id: tx.register_id,
            cashier_id: tx.cashier_id,
            type: tx.type,
            payload: tx.payload,
            entry_date: tx.entry_date,
            status: "pending",
          })
          .select()
          .single()

        if (insertError || !insertedTx) {
          console.error("Failed to insert offline transaction:", insertError)
          results.push({
            local_id: tx.local_id,
            status: "failed",
            error: insertError?.message || "Failed to queue transaction",
          })
          continue
        }

        // 4. Call /api/sales/create internally with entry_date and X-Offline-Sync header
        // Forward cookies to maintain user context
        const createResponse = await fetch(`${baseUrl}/api/sales/create`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookieHeader,
            "X-Offline-Sync": "1", // Signal offline sync mode
          },
          body: JSON.stringify({
            ...tx.payload,
            entry_date: tx.entry_date, // Override created_at with original timestamp
          }),
        })

        const createResult = await createResponse.json()

        if (!createResponse.ok || !createResult.sale_id) {
          // Sync failed - update offline_transactions status
          await supabase
            .from("offline_transactions")
            .update({
              status: "failed",
              error_message: createResult.error || "Failed to create sale during sync",
              retry_count: (insertedTx.retry_count || 0) + 1,
            })
            .eq("id", insertedTx.id)

          results.push({
            local_id: tx.local_id,
            status: "failed",
            error: createResult.error || "Failed to create sale",
          })
          continue
        }

        // 5. Success - update offline_transactions status
        await supabase
          .from("offline_transactions")
          .update({
            status: "synced",
            canonical_sale_id: createResult.sale_id,
            synced_at: new Date().toISOString(),
          })
          .eq("id", insertedTx.id)

        results.push({
          local_id: tx.local_id,
          status: "synced",
          sale_id: createResult.sale_id,
        })
      } catch (error: any) {
        console.error("Error processing offline transaction:", error)
        results.push({
          local_id: tx.local_id,
          status: "failed",
          error: error.message || "Unexpected error during sync",
        })
      }
    }

    return NextResponse.json({
      success: true,
      results,
      synced_count: results.filter((r) => r.status === "synced").length,
      failed_count: results.filter((r) => r.status === "failed").length,
    })
  } catch (error: any) {
    console.error("Error in offline/sync route:", error)
    return NextResponse.json(
      {
        error: error.message || "Internal server error",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 }
    )
  }
}
