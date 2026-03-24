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
    const body = await req.json()
    const { client_name_signed, client_id_type, client_id_number, client_signature } = body

    if (!client_name_signed?.trim()) {
      return NextResponse.json({ error: "Full name is required" }, { status: 400 })
    }
    if (!client_id_type) {
      return NextResponse.json({ error: "ID type is required" }, { status: 400 })
    }
    if (!client_id_number?.trim()) {
      return NextResponse.json({ error: "ID number is required" }, { status: 400 })
    }

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
        { error: "This proforma cannot be accepted in its current state" },
        { status: 409 }
      )
    }

    const { error: updateErr } = await supabase
      .from("proforma_invoices")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
        client_name_signed: client_name_signed.trim(),
        client_id_type,
        client_id_number: client_id_number.trim(),
        client_signature: client_signature ?? null,
        signed_at: new Date().toISOString(),
      })
      .eq("id", proforma.id)

    if (updateErr) {
      console.error("Accept proforma update error:", updateErr)
      return NextResponse.json({ error: "Failed to save acceptance" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error("public/proforma accept error:", err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
