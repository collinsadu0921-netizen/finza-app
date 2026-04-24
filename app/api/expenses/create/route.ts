import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getUserRole } from "@/lib/userRoles"
import { insertExpenseForBusiness } from "@/lib/expenses/insertExpenseForBusiness"
import {
  getIncomingDocumentForBusiness,
  linkIncomingDocumentToEntity,
} from "@/lib/documents/incomingDocumentsService"

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const {
      business_id,
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
      incoming_document_id,
      currency_code,
      fx_rate,
    } = body

    if (!business_id || !supplier || !date || amount == null) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const role = await getUserRole(supabase, user.id, business_id)
    if (!role) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const result = await insertExpenseForBusiness(supabase, {
      businessId: business_id,
      userId: user.id,
      payload: {
        supplier,
        category_id,
        amount: Number(amount),
        nhil,
        getfund,
        covid,
        vat,
        total: total != null ? Number(total) : Number(amount),
        date,
        notes,
        receipt_path,
        currency_code,
        fx_rate,
      },
      request,
      profileSettingsLabel: "Business Profile",
    })

    if (!result.ok) {
      const countryMsg = result.error.includes("Country is required")
      return NextResponse.json(
        {
          error: countryMsg
            ? "Business country is required. Please set it in Business Profile settings."
            : result.error.includes("Currency is required")
              ? "Business currency is required. Please set it in Business Profile settings."
              : result.error.includes("Exchange rate")
                ? `Exchange rate is required for ${String(currency_code ?? "foreign")} expenses. Please enter the current rate.`
                : result.error,
          ...(result.code ? { code: result.code } : {}),
        },
        { status: result.status }
      )
    }

    const expense = result.expense as { id: string }
    const incomingDocId =
      typeof incoming_document_id === "string" ? incoming_document_id.trim() : ""
    if (incomingDocId) {
      const doc = await getIncomingDocumentForBusiness(supabase, incomingDocId, business_id)
      const rp = typeof receipt_path === "string" ? receipt_path.trim() : ""
      if (doc && (!rp || doc.storage_path === rp)) {
        const linkRes = await linkIncomingDocumentToEntity(supabase, {
          documentId: incomingDocId,
          businessId: business_id,
          linkedEntityType: "expense",
          linkedEntityId: expense.id,
          expectedStoragePath: rp || doc.storage_path,
          actualFilePath: rp || doc.storage_path,
        })
        if (!linkRes.ok) {
          console.warn("[expenses/create] incoming document link skipped:", linkRes.error)
        }
      } else if (doc && rp && doc.storage_path !== rp) {
        console.warn("[expenses/create] incoming_document_id ignored: receipt_path does not match document")
      }
    }

    return NextResponse.json({
      success: true,
      expense: result.expense,
    }, { status: 201 })
  } catch (error: any) {
    console.error("Error in expense creation:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

