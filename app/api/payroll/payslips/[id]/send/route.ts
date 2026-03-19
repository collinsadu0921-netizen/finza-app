import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { createAuditLog, getIpAddress, getUserAgent } from "@/lib/auditLog"
import { buildWhatsAppLink } from "@/lib/communication/whatsappLink"
import { sendTransactionalEmail } from "@/lib/email/sendTransactionalEmail"
import { buildPayslipEmailHtml } from "@/lib/email/templates/payslip"
import { getCurrencySymbol } from "@/lib/currency"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const body = await request.json()
    const { sendWhatsApp, sendEmail, email } = body

    // Fetch payslip with all related data
    const { data: payslip, error: payslipError } = await supabase
      .from("payslips")
      .select(`
        id,
        public_token,
        sent_via_whatsapp,
        sent_via_email,
        sent_at,
        payroll_run_id,
        staff_id,
        payroll_entries (
          id,
          basic_salary,
          allowances_total,
          deductions_total,
          gross_salary,
          ssnit_employee,
          ssnit_employer,
          taxable_income,
          paye,
          net_salary
        ),
        staff (
          id,
          name,
          position,
          phone,
          whatsapp_phone,
          email,
          bank_name,
          bank_account,
          ssnit_number,
          tin_number
        ),
        payroll_runs (
          id,
          payroll_month,
          status,
          business_id
        )
      `)
      .eq("id", id)
      .single()

    if (payslipError || !payslip) {
      return NextResponse.json({ error: "Payslip not found" }, { status: 404 })
    }

    // Verify payslip belongs to the current business
    const run = payslip.payroll_runs as any
    if (run?.business_id !== business.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    }

    const staff = payslip.staff as any
    const entry = payslip.payroll_entries as any

    // Build public URL
    let baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
    try {
      if (request.url) {
        const origin = new URL(request.url).origin
        if (origin) baseUrl = origin
      }
    } catch (_) {}

    const publicToken = payslip.public_token
    if (!publicToken) {
      return NextResponse.json(
        { error: "Payslip public link not generated. Please generate payslips first." },
        { status: 400 }
      )
    }
    const publicUrl = `${baseUrl}/payslips/${publicToken}`

    // Business currency
    const { data: bizProfile } = await supabase
      .from("businesses")
      .select("legal_name, trading_name, default_currency")
      .eq("id", business.id)
      .single()

    const businessName = bizProfile?.trading_name || bizProfile?.legal_name || "Your Employer"
    const currencyCode = bizProfile?.default_currency ?? null
    const currencySymbol = currencyCode ? (getCurrencySymbol(currencyCode) ?? currencyCode) : "₵"

    // Payroll month label
    const payrollMonth = run?.payroll_month
      ? new Date(run.payroll_month).toLocaleDateString("en-GH", { month: "long", year: "numeric" })
      : "N/A"

    const now = new Date().toISOString()

    // ──────────────────────────────────────────────
    // WHATSAPP
    // ──────────────────────────────────────────────
    if (sendWhatsApp) {
      const phone = staff?.whatsapp_phone || staff?.phone
      if (!phone) {
        return NextResponse.json(
          { error: `${staff?.name || "Staff member"} does not have a phone number on record. Please add one to their profile.` },
          { status: 400 }
        )
      }

      const netSalary = Number(entry?.net_salary ?? 0).toFixed(2)
      const grossSalary = Number(entry?.gross_salary ?? 0).toFixed(2)
      const paye = Number(entry?.paye ?? 0).toFixed(2)
      const ssnit = Number(entry?.ssnit_employee ?? 0).toFixed(2)

      const message =
        `Hello ${staff.name},\n\n` +
        `Your payslip for *${payrollMonth}* from *${businessName}* is ready.\n\n` +
        `💰 Gross Pay: ${currencySymbol}${grossSalary}\n` +
        `📋 PAYE Tax: ${currencySymbol}${paye}\n` +
        `📋 SSNIT: ${currencySymbol}${ssnit}\n` +
        `✅ Net Pay: *${currencySymbol}${netSalary}*\n\n` +
        `View your full payslip here:\n${publicUrl}`

      const linkResult = buildWhatsAppLink(phone, message)
      if (!linkResult.ok) {
        return NextResponse.json({ error: linkResult.error }, { status: 400 })
      }

      // Mark as sent
      await supabase
        .from("payslips")
        .update({
          sent_via_whatsapp: true,
          whatsapp_sent_at: now,
          sent_at: payslip.sent_at ?? now,
        })
        .eq("id", id)

      // Audit log
      try {
        await createAuditLog({
          businessId: business.id,
          userId: user.id,
          actionType: "payslip.sent_whatsapp",
          entityType: "payslip",
          entityId: id,
          newValues: { staff_name: staff.name, recipient_phone: phone, payroll_month: payrollMonth },
          ipAddress: getIpAddress(request),
          userAgent: getUserAgent(request),
          description: `Payslip sent via WhatsApp to ${staff.name} for ${payrollMonth}`,
        })
      } catch (_) {}

      // Optional server-side send
      try {
        const { sendWhatsAppMessage } = await import("@/lib/communication/sendWhatsAppMessage")
        await sendWhatsAppMessage({
          to: `+${linkResult.digits}`,
          body: message,
          reference: `payslip-${id}`,
          businessId: business.id,
          entityType: "payslip" as any,
          entityId: id,
        })
      } catch (_) {}

      return NextResponse.json({
        success: true,
        whatsappUrl: linkResult.whatsappUrl,
        message: "WhatsApp link generated",
      })
    }

    // ──────────────────────────────────────────────
    // EMAIL
    // ──────────────────────────────────────────────
    if (sendEmail) {
      const toEmail = (email || staff?.email || "").trim().toLowerCase()
      if (!toEmail) {
        return NextResponse.json(
          { error: "No email address available. Please provide one or add it to the staff profile." },
          { status: 400 }
        )
      }

      const html = buildPayslipEmailHtml({
        staffName: staff?.name ?? "Staff Member",
        payrollMonth,
        businessName,
        currencySymbol,
        basicSalary: Number(entry?.basic_salary ?? 0),
        allowancesTotal: Number(entry?.allowances_total ?? 0),
        deductionsTotal: Number(entry?.deductions_total ?? 0),
        grossSalary: Number(entry?.gross_salary ?? 0),
        ssnitEmployee: Number(entry?.ssnit_employee ?? 0),
        paye: Number(entry?.paye ?? 0),
        netSalary: Number(entry?.net_salary ?? 0),
        publicUrl,
        position: staff?.position ?? undefined,
        bankName: staff?.bank_name ?? undefined,
        bankAccount: staff?.bank_account ?? undefined,
      })

      const result = await sendTransactionalEmail({
        to: toEmail,
        subject: `Your Payslip for ${payrollMonth} — ${businessName}`,
        html,
      })

      if (!result.success) {
        return NextResponse.json(
          {
            success: false,
            error: result.reason === "no_api_key"
              ? "Email is not configured. Add RESEND_API_KEY to your environment."
              : "Email delivery failed. Please try again.",
          },
          { status: 502 }
        )
      }

      // Mark as sent
      await supabase
        .from("payslips")
        .update({
          sent_via_email: true,
          email_sent_at: now,
          sent_at: payslip.sent_at ?? now,
        })
        .eq("id", id)

      // Audit log
      try {
        await createAuditLog({
          businessId: business.id,
          userId: user.id,
          actionType: "payslip.sent_email",
          entityType: "payslip",
          entityId: id,
          newValues: { staff_name: staff.name, recipient_email: toEmail, payroll_month: payrollMonth },
          ipAddress: getIpAddress(request),
          userAgent: getUserAgent(request),
          description: `Payslip emailed to ${staff.name} (${toEmail}) for ${payrollMonth}`,
        })
      } catch (_) {}

      return NextResponse.json({ success: true, message: "Payslip sent via email" })
    }

    return NextResponse.json({ error: "Specify sendWhatsApp or sendEmail" }, { status: 400 })
  } catch (err: any) {
    console.error("Error sending payslip:", err)
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 })
  }
}
