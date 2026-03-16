import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { createAuditLog } from "@/lib/auditLog"
import { handleFilePersistence } from "@/lib/fileHandlingServer"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const expenseId = resolvedParams.id

    if (!expenseId) {
      return NextResponse.json(
        { error: "Expense ID is required" },
        { status: 400 }
      )
    }

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const { data: expense, error } = await supabase
      .from("expenses")
      .select(
        `
        *,
        expense_categories (
          id,
          name
        )
      `
      )
      .eq("id", expenseId)
      .eq("business_id", business.id)
      .maybeSingle()

    if (error) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[expenses/[id]] GET Supabase error:", error.message, error.code)
      }
      return NextResponse.json(
        { error: "Failed to load expense" },
        { status: 500 }
      )
    }

    if (!expense) {
      return NextResponse.json(
        { error: "Expense not found" },
        { status: 404 }
      )
    }

    return NextResponse.json({ expense })
  } catch (error: any) {
    console.error("Error fetching expense:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const expenseId = resolvedParams.id

    if (!expenseId) {
      return NextResponse.json(
        { error: "Expense ID is required" },
        { status: 400 }
      )
    }

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const body = await request.json()
    const {
      supplier,
      category_id,
      amount,
      nhil,
      getfund,
      covid,
      vat,
      total,
      date,
      notes,
      receipt_path,
    } = body

    // Fetch existing expense with receipt_path to preserve it if not updated
    const { data: existingExpense } = await supabase
      .from("expenses")
      .select("id, receipt_path")
      .eq("id", expenseId)
      .eq("business_id", business.id)
      .maybeSingle()

    if (!existingExpense) {
      return NextResponse.json(
        { error: "Expense not found" },
        { status: 404 }
      )
    }

    // Handle receipt file persistence using standardized utility
    // This ensures files are preserved unless explicitly removed or replaced
    const filePersistenceResult = await handleFilePersistence({
      supabase,
      bucket: "receipts",
      existingFilePath: existingExpense.receipt_path,
      newFilePath: receipt_path, // undefined = preserve, null = remove, string = replace
    })

    if (filePersistenceResult.deletionError) {
      console.warn("File deletion warning (non-fatal):", filePersistenceResult.deletionError)
    }

    const updateData: any = {
      updated_at: new Date().toISOString(),
    }

    if (supplier) updateData.supplier = supplier
    if (category_id !== undefined) updateData.category_id = category_id
    if (date) updateData.date = date
    if (amount !== undefined) {
      updateData.amount = Number(amount)
      updateData.nhil = Number(nhil || 0)
      updateData.getfund = Number(getfund || 0)
      updateData.covid = Number(covid || 0)
      updateData.vat = Number(vat || 0)
      updateData.total = Number(total || amount)
    }
    if (notes !== undefined) updateData.notes = notes
    // Always set receipt_path to the determined value (preserved or updated)
    updateData.receipt_path = filePersistenceResult.finalFilePath

    const { data: expense, error } = await supabase
      .from("expenses")
      .update(updateData)
      .eq("id", expenseId)
      .eq("business_id", business.id)
      .select(
        `
        *,
        expense_categories (
          id,
          name
        )
      `
      )
      .single()

    if (error) {
      console.error("Error updating expense:", error)
      const msg = error.message ?? ""
      if (
        msg.includes("Posted expenses are immutable") ||
        msg.includes("Cannot modify expenses in a closed or locked accounting period")
      ) {
        return NextResponse.json(
          { error: msg, code: msg.includes("immutable") ? "EXPENSE_IMMUTABLE" : "PERIOD_CLOSED" },
          { status: 400 }
        )
      }
      return NextResponse.json(
        { error: msg },
        { status: 500 }
      )
    }

    // Ledger: if expense was posted, reverse prior posting and post new (immutable-safe)
    try {
      const { error: repostError } = await supabase.rpc("repost_expense_to_ledger", {
        p_expense_id: expenseId,
      })
      if (repostError) {
        const repostMsg = repostError.message ?? ""
        if (
          repostMsg.includes("closed") ||
          repostMsg.includes("locked") ||
          repostMsg.includes("accounting period")
        ) {
          return NextResponse.json(
            {
              error: repostMsg,
              code: "PERIOD_CLOSED",
              expense,
            },
            { status: 400 }
          )
        }
        console.error("repost_expense_to_ledger error (non-fatal):", repostError)
      }
    } catch (repostErr: unknown) {
      console.error("repost_expense_to_ledger threw:", repostErr)
    }

    // Log audit entry
    try {
      if (business && expense) {
        await createAuditLog({
          businessId: business.id,
          userId: user?.id || null,
          actionType: "expense.updated",
          entityType: "expense",
          entityId: expenseId,
          oldValues: existingExpense,
          newValues: expense,
          request,
        })
      }
    } catch (auditError) {
      console.error("Error logging audit:", auditError)
    }

    return NextResponse.json({ expense })
  } catch (error: any) {
    console.error("Error updating expense:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const expenseId = resolvedParams.id

    if (!expenseId) {
      return NextResponse.json(
        { error: "Expense ID is required" },
        { status: 400 }
      )
    }

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const { data: existingExpense } = await supabase
      .from("expenses")
      .select("id")
      .eq("id", expenseId)
      .eq("business_id", business.id)
      .maybeSingle()

    if (!existingExpense) {
      return NextResponse.json(
        { error: "Expense not found" },
        { status: 404 }
      )
    }

    const { error } = await supabase
      .from("expenses")
      .delete()
      .eq("id", expenseId)
      .eq("business_id", business.id)

    if (error) {
      console.error("Error deleting expense:", error)
      const msg = error.message ?? ""
      if (
        msg.includes("Posted expenses are immutable") ||
        msg.includes("Cannot modify expenses in a closed or locked accounting period")
      ) {
        return NextResponse.json(
          { error: msg, code: msg.includes("immutable") ? "EXPENSE_IMMUTABLE" : "PERIOD_CLOSED" },
          { status: 400 }
        )
      }
      return NextResponse.json(
        { error: msg },
        { status: 500 }
      )
    }

    // Log audit entry
    try {
      await createAuditLog({
        businessId: business.id,
        userId: user.id,
        actionType: "expense.deleted",
        entityType: "expense",
        entityId: expenseId,
        oldValues: existingExpense,
        newValues: null,
        request,
        description: `Expense ${expenseId} deleted`,
      })
    } catch (auditError) {
      console.error("Error logging audit:", auditError)
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Error deleting expense:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

