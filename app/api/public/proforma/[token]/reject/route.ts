import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token: rawToken } = await params
    const token = decodeURIComponent(rawToken).trim()
    if (!token) {
      return NextResponse.json({ error: "Proforma not found" }, { status: 404 })
    }

    const supabase = serviceClient()
    const body = await req.json().catch(() => ({}))
    const { reason } = body

    const { data: proforma, error: fetchErr } = await supabase
      .from("proforma_invoices")
      .select("id, status")
      .eq("public_token", token)
      .is("deleted_at", null)
      .single()

    if (fetchErr || !proforma) {
      return NextResponse.json({ error: "Proforma not found" }, { status: 404 })
    }
    if (proforma.status !== "sent") {
      return NextResponse.json(
        { error: "This proforma cannot be declined in its current state" },
        { status: 409 }
      )
    }

    const { error: updateErr } = await supabase
      .from("proforma_invoices")
      .update({
        status: "rejected",
        rejected_reason: reason?.trim() ?? null,
        rejected_at: new Date().toISOString(),
      })
      .eq("id", proforma.id)

    if (updateErr) {
      console.error("Reject proforma update error:", updateErr)
      return NextResponse.json({ error: "Failed to save rejection" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error("public/proforma reject error:", err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
