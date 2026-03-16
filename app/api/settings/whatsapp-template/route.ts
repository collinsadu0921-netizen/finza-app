import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { getBusinessWhatsAppTemplate } from "@/lib/communication/getBusinessWhatsAppTemplate"
import { validateWhatsAppTemplate } from "@/lib/communication/validateWhatsAppTemplate"
import type { WhatsAppTemplateType } from "@/lib/communication/getBusinessWhatsAppTemplate"

const VALID_TYPES: WhatsAppTemplateType[] = ["invoice", "estimate", "order"]

export async function GET(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const type = searchParams.get("type") as WhatsAppTemplateType | null
    if (!type || !VALID_TYPES.includes(type)) {
      return NextResponse.json(
        { error: "Invalid or missing type. Use invoice, estimate, or order." },
        { status: 400 }
      )
    }

    const template = await getBusinessWhatsAppTemplate(supabase, business.id, type)
    return NextResponse.json({ template, type })
  } catch (e: any) {
    console.error("WhatsApp template GET:", e)
    return NextResponse.json(
      { error: e?.message || "Failed to load template" },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const type = body?.type as WhatsAppTemplateType | undefined
    const template = typeof body?.template === "string" ? body.template : ""

    if (!type || !VALID_TYPES.includes(type)) {
      return NextResponse.json(
        { error: "Invalid or missing type. Use invoice, estimate, or order." },
        { status: 400 }
      )
    }

    const validation = validateWhatsAppTemplate(template, type)
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const { error } = await supabase
      .from("business_whatsapp_templates")
      .upsert(
        {
          business_id: business.id,
          type,
          template: validation.template,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "business_id,type" }
      )

    if (error) {
      console.error("WhatsApp template save:", error)
      return NextResponse.json(
        { error: error.message || "Failed to save template" },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, type })
  } catch (e: any) {
    console.error("WhatsApp template POST:", e)
    return NextResponse.json(
      { error: e?.message || "Failed to save template" },
      { status: 500 }
    )
  }
}
