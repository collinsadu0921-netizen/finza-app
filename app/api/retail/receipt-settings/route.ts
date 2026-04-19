import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { getUserRole } from "@/lib/userRoles"
import { canEditBusinessWideSensitiveSettings } from "@/lib/retail/retailSensitiveSettingsEditors"

/**
 * Retail receipt_settings (business-wide). Reads allowed for any business member;
 * writes restricted to owner/admin.
 */
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
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const role = await getUserRole(supabase, user.id, business.id)
    if (!role) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const { data, error: fetchError } = await supabase
      .from("receipt_settings")
      .select("*")
      .eq("business_id", business.id)
      .maybeSingle()

    if (fetchError && fetchError.code !== "PGRST116") {
      return NextResponse.json({ error: fetchError.message }, { status: 500 })
    }

    return NextResponse.json({
      business_id: business.id,
      can_edit: canEditBusinessWideSensitiveSettings(role),
      settings: data ?? null,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Internal error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
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
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const editorRole = await getUserRole(supabase, user.id, business.id)
    if (!canEditBusinessWideSensitiveSettings(editorRole)) {
      return NextResponse.json(
        { error: "Forbidden: only owners and admins can update receipt settings." },
        { status: 403 }
      )
    }

    const body = (await request.json()) as Record<string, unknown>
    const settings = body.settings as Record<string, unknown> | undefined
    if (!settings || typeof settings !== "object") {
      return NextResponse.json({ error: "Missing settings object" }, { status: 400 })
    }

    const row = {
      business_id: business.id,
      printer_type: settings.printer_type,
      printer_width: settings.printer_width,
      auto_cut: settings.auto_cut,
      drawer_kick: settings.drawer_kick,
      show_logo: settings.show_logo,
      receipt_mode: settings.receipt_mode,
      footer_text: settings.footer_text,
      show_qr_code: settings.show_qr_code,
      qr_code_content: settings.qr_code_content,
      updated_at: new Date().toISOString(),
    }

    const { error: upsertError } = await supabase.from("receipt_settings").upsert(row, {
      onConflict: "business_id",
    })

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Internal error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
