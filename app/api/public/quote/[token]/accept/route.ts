import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabaseClient"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
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

    // Fetch the estimate to validate it is in 'sent' status
    const { data: estimate, error: fetchErr } = await supabase
      .from("estimates")
      .select("id, status")
      .eq("public_token", token)
      .is("deleted_at", null)
      .single()

    if (fetchErr || !estimate) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 })
    }
    if (estimate.status !== "sent") {
      return NextResponse.json(
        { error: "This quote cannot be accepted in its current state" },
        { status: 409 }
      )
    }

    const { error: updateErr } = await supabase
      .from("estimates")
      .update({
        status: "accepted",
        client_name_signed: client_name_signed.trim(),
        client_id_type,
        client_id_number: client_id_number.trim(),
        client_signature: client_signature ?? null,
        signed_at: new Date().toISOString(),
      })
      .eq("id", estimate.id)

    if (updateErr) {
      console.error("Accept quote update error:", updateErr)
      return NextResponse.json({ error: "Failed to save acceptance" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error("public/quote accept error:", err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
