/**
 * POST /api/payroll/runs/[id]/send-all
 *
 * Bulk-sends payslips for all employees in a payroll run.
 * - Prefers email (more reliable for bulk)
 * - Falls back to server-side WhatsApp if no email but has phone number
 * - Skips employees with no contact info
 *
 * Returns: { sent: number, skipped: number, errors: string[] }
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"
import { inferFinzaWorkspaceFromIndustry } from "@/lib/email/buildFinzaResendTags"
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
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 })

    const { allowed } = await requirePermission(supabase, user.id, business.id, PERMISSIONS.PAYROLL_PAYSLIPS)
    if (!allowed) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })

    // Verify run belongs to business
    const { data: payrollRun } = await supabase
      .from("payroll_runs")
      .select("id, payroll_month, status")
      .eq("id", id)
      .eq("business_id", business.id)
      .single()

    if (!payrollRun) return NextResponse.json({ error: "Payroll run not found" }, { status: 404 })
    if (payrollRun.status === "draft") {
      return NextResponse.json({ error: "Payroll must be approved before sending payslips." }, { status: 400 })
    }

    // Fetch all payslips with staff + entry data
    const { data: payslips, error: psError } = await supabase
      .from("payslips")
      .select(`
        id,
        public_token,
        sent_via_email,
        sent_via_whatsapp,
        staff_id,
        payroll_entries (
          basic_salary,
          allowances_total,
          deductions_total,
          gross_salary,
          ssnit_employee,
          paye,
          net_salary
        ),
        staff (
          id,
          name,
          position,
          email,
          phone,
          whatsapp_phone,
          bank_name,
          bank_account
        )
      `)
      .eq("payroll_run_id", id)

    if (psError) return NextResponse.json({ error: psError.message }, { status: 500 })
    if (!payslips || payslips.length === 0) {
      return NextResponse.json({ error: "No payslips found. Generate payslips first." }, { status: 400 })
    }

    // Business info
    const { data: bizProfile } = await supabase
      .from("businesses")
      .select("legal_name, trading_name, default_currency, email")
      .eq("id", business.id)
      .single()

    const businessName = bizProfile?.trading_name || bizProfile?.legal_name || "Your Employer"
    const currencyCode = bizProfile?.default_currency ?? null
    const currencySymbol = currencyCode ? (getCurrencySymbol(currencyCode) ?? currencyCode) : "₵"

    const payrollMonth = new Date(payrollRun.payroll_month).toLocaleDateString("en-GH", {
      month: "long",
      year: "numeric",
    })

    let baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
    try {
      const origin = new URL(request.url).origin
      if (origin) baseUrl = origin
    } catch (_) {}

    const now = new Date().toISOString()
    let sent = 0
    let skipped = 0
    const errors: string[] = []

    for (const payslip of payslips) {
      const staff = payslip.staff as any
      const entry = payslip.payroll_entries as any

      if (!payslip.public_token) {
        skipped++
        continue
      }

      const publicUrl = `${baseUrl}/payslips/${encodeURIComponent(payslip.public_token)}`
      const toEmail = staff?.email?.trim().toLowerCase()
      const phone = staff?.whatsapp_phone || staff?.phone

      if (toEmail) {
        // Send via email
        try {
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
            fromName: businessName,
            replyTo: bizProfile?.email ?? undefined,
            finza: {
              businessId: business.id,
              documentId: String(payslip.id),
              documentType: "account",
              workspace: inferFinzaWorkspaceFromIndustry((business as { industry?: string | null }).industry),
            },
          })

          if (result.success) {
            const { error: updErr } = await supabase
              .from("payslips")
              .update({ sent_via_email: true, email_sent_at: now, sent_at: now })
              .eq("id", payslip.id)
            if (updErr) {
              console.error("send-all payslip update failed:", updErr)
              errors.push(`${staff?.name ?? payslip.id}: could not save sent status`)
              skipped++
            } else {
              sent++
            }
          } else {
            errors.push(`${staff?.name ?? payslip.id}: email failed`)
            skipped++
          }
        } catch (e: any) {
          errors.push(`${staff?.name ?? payslip.id}: ${e.message}`)
          skipped++
        }
      } else if (phone) {
        // Attempt server-side WhatsApp
        try {
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

          const { sendWhatsAppMessage } = await import("@/lib/communication/sendWhatsAppMessage")
          await sendWhatsAppMessage({
            to: `+${phone.replace(/\D/g, "")}`,
            body: message,
            reference: `payslip-${payslip.id}`,
            businessId: business.id,
            entityType: "payslip" as any,
            entityId: payslip.id,
          })

          const { error: waUpdErr } = await supabase
            .from("payslips")
            .update({ sent_via_whatsapp: true, whatsapp_sent_at: now, sent_at: now })
            .eq("id", payslip.id)
          if (waUpdErr) {
            console.error("send-all payslip WhatsApp update failed:", waUpdErr)
            errors.push(`${staff?.name ?? payslip.id}: could not save sent status`)
            skipped++
          } else {
            sent++
          }
        } catch (e: any) {
          errors.push(`${staff?.name ?? payslip.id}: WhatsApp failed`)
          skipped++
        }
      } else {
        skipped++
      }
    }

    return NextResponse.json({
      success: true,
      sent,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
    })
  } catch (err: any) {
    console.error("Error in POST /send-all:", err)
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 })
  }
}
