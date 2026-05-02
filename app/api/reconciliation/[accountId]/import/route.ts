import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { enforceServiceIndustryBusinessTierForAccountingApi } from "@/lib/serviceWorkspace/enforceServiceIndustryBusinessTierForAccountingApi"
import {
  normalizeBankImportRow,
  sanitizeImportFilename,
  type BankImportSourceMeta,
  type NormalizedBankImportRow,
} from "@/lib/reconciliation/bankStatementCsv"

type ImportRowInput = {
  date?: unknown
  description?: unknown
  amount?: unknown
  reference?: unknown
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> | { accountId: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const accountId = resolvedParams.accountId

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 })

    const tierBlockImp = await enforceServiceIndustryBusinessTierForAccountingApi(
      supabase,
      user.id,
      business.id
    )
    if (tierBlockImp) return tierBlockImp

    const { data: account } = await supabase
      .from("accounts")
      .select("id")
      .eq("id", accountId)
      .eq("business_id", business.id)
      .single()

    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 })
    }

    const body = await request.json()
    const { rows, meta } = body as {
      rows?: ImportRowInput[]
      meta?: BankImportSourceMeta
    }

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "No transactions provided" }, { status: 400 })
    }

    const source: BankImportSourceMeta["source"] =
      meta?.source === "file" || meta?.source === "paste" ? meta.source : "paste"
    const filename =
      source === "file" ? sanitizeImportFilename(meta?.filename ?? null) : null

    const rowErrors: { rowIndex: number; errors: string[] }[] = []
    const normalizedRows: NormalizedBankImportRow[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const res = normalizeBankImportRow({
        date: String(row?.date ?? ""),
        description: String(row?.description ?? ""),
        amount: row?.amount as string | number,
        reference: row?.reference == null ? null : String(row.reference),
      })
      if (!res.ok) {
        rowErrors.push({ rowIndex: i + 1, errors: res.errors })
      } else {
        normalizedRows.push(res.normalized)
      }
    }

    if (rowErrors.length > 0) {
      return NextResponse.json(
        {
          error: "One or more rows failed validation",
          rowErrors,
        },
        { status: 400 }
      )
    }

    const { data: batch, error: batchError } = await supabase
      .from("bank_import_batches")
      .insert({
        business_id: business.id,
        account_id: accountId,
        source,
        filename,
        created_by: user.id,
        row_count: normalizedRows.length,
        status: "applied",
      })
      .select("id")
      .single()

    if (batchError || !batch) {
      console.error("bank_import_batches insert:", batchError)
      return NextResponse.json(
        { error: batchError?.message || "Failed to create import batch" },
        { status: 500 }
      )
    }

    const mappedTransactions = normalizedRows.map((r) => ({
      business_id: business.id,
      account_id: accountId,
      date: r.date,
      description: r.description,
      amount: r.amountAbs,
      type: r.type,
      external_ref: r.reference,
      status: "unreconciled",
      import_batch_id: batch.id,
    }))

    const { data: insertedTransactions, error: insertError } = await supabase
      .from("bank_transactions")
      .insert(mappedTransactions)
      .select()

    if (insertError) {
      console.error("Error importing transactions:", insertError)
      await supabase
        .from("bank_import_batches")
        .update({ status: "failed" })
        .eq("id", batch.id)
      return NextResponse.json(
        { error: insertError.message || "Failed to import transactions" },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: `Successfully imported ${insertedTransactions?.length || 0} transactions`,
      count: insertedTransactions?.length || 0,
      transactions: insertedTransactions || [],
      import_batch_id: batch.id,
    })
  } catch (error: any) {
    console.error("Error importing transactions:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
