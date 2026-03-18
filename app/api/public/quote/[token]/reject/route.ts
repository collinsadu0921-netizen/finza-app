import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabaseClient"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const body = await req.json().catch(() => ({}))
    const { reason } = body

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
        { error: "This quote cannot be declined in its current state" },
        { status: 409 }
      )
    }

    const { error: updateErr } = await supabase
      .from("estimates")
      .update({
        status: "rejected",
        rejected_reason: reason?.trim() ?? null,
        rejected_at: new Date().toISOString(),
      })
      .eq("id", estimate.id)

    if (updateErr) {
      console.error("Reject quote update error:", updateErr)
      return NextResponse.json({ error: "Failed to save rejection" }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error("public/quote reject error:", err)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
