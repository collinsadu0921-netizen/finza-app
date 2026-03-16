import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"

export async function GET(request: NextRequest) {
  try {
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

    // Get or create reminder settings
    let { data: settings, error } = await supabase
      .from("business_reminder_settings")
      .select("*")
      .eq("business_id", business.id)
      .maybeSingle()

    if (error && error.code !== "PGRST116") {
      console.error("Error fetching reminder settings:", error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    // Create default settings if none exist
    if (!settings) {
      const { data: newSettings, error: insertError } = await supabase
        .from("business_reminder_settings")
        .insert({
          business_id: business.id,
          overdue_reminders_enabled: false,
          reminder_frequency_days: [3, 7, 14],
          reminder_message_template: null,
        })
        .select()
        .single()

      if (insertError) {
        console.error("Error creating reminder settings:", insertError)
        return NextResponse.json(
          { error: insertError.message },
          { status: 500 }
        )
      }

      settings = newSettings
    }

    return NextResponse.json({ settings })
  } catch (error: any) {
    console.error("Error fetching reminder settings:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
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
      overdue_reminders_enabled,
      email_reminders_enabled,
      reminder_frequency_days,
      reminder_interval_days,
      reminder_message_template,
      email_reminder_template,
    } = body

    // Check if settings exist
    const { data: existingSettings } = await supabase
      .from("business_reminder_settings")
      .select("id")
      .eq("business_id", business.id)
      .maybeSingle()

    let settings
    if (existingSettings) {
      // Update existing
      const updateData: any = {
        overdue_reminders_enabled,
        reminder_frequency_days,
        reminder_message_template,
        updated_at: new Date().toISOString(),
      }

      // Add email reminder fields if provided
      if (email_reminders_enabled !== undefined) {
        updateData.email_reminders_enabled = email_reminders_enabled
      }
      if (reminder_interval_days !== undefined) {
        updateData.reminder_interval_days = reminder_interval_days
      }
      if (email_reminder_template !== undefined) {
        updateData.email_reminder_template = email_reminder_template
      }

      const { data: updatedSettings, error: updateError } = await supabase
        .from("business_reminder_settings")
        .update(updateData)
        .eq("business_id", business.id)
        .select()
        .single()

      if (updateError) {
        console.error("Error updating reminder settings:", updateError)
        return NextResponse.json(
          { error: updateError.message },
          { status: 500 }
        )
      }

      settings = updatedSettings
    } else {
      // Create new
      const { data: newSettings, error: insertError } = await supabase
        .from("business_reminder_settings")
        .insert({
          business_id: business.id,
          overdue_reminders_enabled: overdue_reminders_enabled || false,
          email_reminders_enabled: email_reminders_enabled !== undefined ? email_reminders_enabled : true,
          reminder_frequency_days: reminder_frequency_days || [3, 7, 14],
          reminder_interval_days: reminder_interval_days || 7,
          reminder_message_template: reminder_message_template || null,
          email_reminder_template: email_reminder_template || null,
        })
        .select()
        .single()

      if (insertError) {
        console.error("Error creating reminder settings:", insertError)
        return NextResponse.json(
          { error: insertError.message },
          { status: 500 }
        )
      }

      settings = newSettings
    }

    return NextResponse.json({ settings })
  } catch (error: any) {
    console.error("Error updating reminder settings:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

