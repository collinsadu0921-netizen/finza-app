/**
 * GET  /api/payroll/advances
 *   Returns all salary advances for the current business, enriched with:
 *   - staff name
 *   - repaid amount (based on approved/locked payroll runs since date_issued)
 *   - outstanding balance
 *   Also returns staff list and bank/cash accounts for the issue form.
 *
 * POST /api/payroll/advances
 *   Issues a salary advance to an employee:
 *   1. Inserts salary_advances record
 *   2. Posts journal entry: Dr Staff Advances (1110), Cr Bank/Cash
 *   3. Creates a recurring deduction on the staff member linked to the advance
 */

import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { requirePermission } from "@/lib/userPermissions"
import { PERMISSIONS } from "@/lib/permissions"

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 })

    const { allowed } = await requirePermission(supabase, user.id, business.id, PERMISSIONS.PAYROLL_VIEW)
    if (!allowed) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })

    // ── Fetch advances with staff join ────────────────────────────────────────
    const { data: advances, error: advErr } = await supabase
      .from("salary_advances")
      .select("*, staff:staff_id(id, name, position)")
      .eq("business_id", business.id)
      .order("date_issued", { ascending: false })

    if (advErr) return NextResponse.json({ error: advErr.message }, { status: 500 })

    // ── Fetch bank/cash accounts ──────────────────────────────────────────────
    const { data: bankAccounts } = await supabase
      .from("accounts")
      .select("id, name, code, sub_type")
      .eq("business_id", business.id)
      .eq("type", "asset")
      .in("sub_type", ["bank", "cash"])
      .is("deleted_at", null)
      .order("code", { ascending: true })

    // Also include accounts without sub_type that match bank/cash names as fallback
    const { data: allAssetAccounts } = await supabase
      .from("accounts")
      .select("id, name, code, sub_type")
      .eq("business_id", business.id)
      .eq("type", "asset")
      .is("deleted_at", null)
      .in("code", ["1000", "1010", "1020"])

    // Merge and deduplicate
    const bankAccountMap = new Map<string, any>()
    for (const a of [...(bankAccounts ?? []), ...(allAssetAccounts ?? [])]) {
      bankAccountMap.set(a.id, a)
    }
    const mergedBankAccounts = Array.from(bankAccountMap.values())
      .sort((a, b) => a.code.localeCompare(b.code))

    // ── Fetch active staff ────────────────────────────────────────────────────
    const { data: staff } = await supabase
      .from("staff")
      .select("id, name, position")
      .eq("business_id", business.id)
      .eq("status", "active")
      .is("deleted_at", null)
      .order("name", { ascending: true })

    if (!advances || advances.length === 0) {
      return NextResponse.json({
        advances: [],
        staff: staff ?? [],
        bankAccounts: mergedBankAccounts,
      })
    }

    // ── Enrich each advance with repaid / outstanding ─────────────────────────
    // Get all approved/locked run IDs for this business once
    const { data: approvedRuns } = await supabase
      .from("payroll_runs")
      .select("id, payroll_month")
      .eq("business_id", business.id)
      .in("status", ["approved", "locked"])

    const enriched = await Promise.all(
      (advances as any[]).map(async (adv) => {
        let repaid = 0

        if (approvedRuns && approvedRuns.length > 0) {
          // Filter runs that occurred on or after the advance date
          const relevantRunIds = approvedRuns
            .filter((r) => r.payroll_month >= adv.date_issued)
            .map((r) => r.id)

          if (relevantRunIds.length > 0) {
            const { count } = await supabase
              .from("payroll_entries")
              .select("id", { count: "exact", head: true })
              .eq("staff_id", adv.staff_id)
              .in("payroll_run_id", relevantRunIds)

            repaid = Math.min(
              Number(adv.monthly_repayment) * (count ?? 0),
              Number(adv.amount)
            )
          }
        }

        const outstanding = Math.max(0, Number(adv.amount) - repaid)

        return {
          ...adv,
          staff_name: (adv.staff as any)?.name ?? null,
          repaid,
          outstanding,
        }
      })
    )

    return NextResponse.json({
      advances: enriched,
      staff: staff ?? [],
      bankAccounts: mergedBankAccounts,
    })
  } catch (err: any) {
    console.error("Error in GET /api/payroll/advances:", err)
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 })

    const { allowed } = await requirePermission(supabase, user.id, business.id, PERMISSIONS.PAYROLL_CREATE)
    if (!allowed) return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })

    const body = await request.json().catch(() => null)
    if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

    const { staff_id, amount, monthly_repayment, date_issued, bank_account_id, notes } = body

    if (!staff_id) return NextResponse.json({ error: "staff_id is required" }, { status: 400 })
    if (!amount || Number(amount) <= 0) return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 })
    if (!monthly_repayment || Number(monthly_repayment) <= 0) return NextResponse.json({ error: "monthly_repayment must be a positive number" }, { status: 400 })
    if (!date_issued || !/^\d{4}-\d{2}-\d{2}$/.test(date_issued)) return NextResponse.json({ error: "date_issued must be YYYY-MM-DD" }, { status: 400 })
    if (!bank_account_id) return NextResponse.json({ error: "bank_account_id is required" }, { status: 400 })

    // Verify staff belongs to this business
    const { data: staffMember } = await supabase
      .from("staff")
      .select("id, name")
      .eq("id", staff_id)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .single()

    if (!staffMember) return NextResponse.json({ error: "Staff member not found" }, { status: 404 })

    // Verify bank account belongs to this business
    const { data: bankAccount } = await supabase
      .from("accounts")
      .select("id, name")
      .eq("id", bank_account_id)
      .eq("business_id", business.id)
      .is("deleted_at", null)
      .single()

    if (!bankAccount) return NextResponse.json({ error: "Bank account not found" }, { status: 404 })

    // Find accounting period for the advance date
    const { data: period } = await supabase
      .from("accounting_periods")
      .select("id, status")
      .eq("business_id", business.id)
      .lte("period_start", date_issued)
      .gte("period_end", date_issued)
      .order("period_start", { ascending: false })
      .limit(1)
      .single()

    if (!period) {
      return NextResponse.json(
        { error: `No accounting period found for ${date_issued}. Ensure the period exists.` },
        { status: 400 }
      )
    }
    if (period.status === "locked") {
      return NextResponse.json({ error: "Cannot post to a locked period. Choose another date." }, { status: 400 })
    }

    // Find Staff Advances account (1110)
    const { data: staffAdvancesAcct } = await supabase
      .from("accounts")
      .select("id")
      .eq("business_id", business.id)
      .eq("code", "1110")
      .is("deleted_at", null)
      .single()

    if (!staffAdvancesAcct) {
      return NextResponse.json(
        { error: "Staff Advances account (1110) not found. Please run pending migrations." },
        { status: 400 }
      )
    }

    const description = `Salary Advance — ${staffMember.name}`

    // Insert journal entry header
    const { data: je, error: jeError } = await supabase
      .from("journal_entries")
      .insert({
        business_id: business.id,
        date: date_issued,
        description,
        reference_type: "salary_advance",
        period_id: period.id,
        created_by: user.id,
        posted_by: user.id,
        posting_source: "system",
      })
      .select("id")
      .single()

    if (jeError || !je) {
      console.error("JE insert error:", jeError)
      return NextResponse.json({ error: jeError?.message || "Failed to create journal entry" }, { status: 500 })
    }

    // Insert journal entry lines: Dr Staff Advances (1110), Cr Bank/Cash
    const { error: linesError } = await supabase
      .from("journal_entry_lines")
      .insert([
        {
          journal_entry_id: je.id,
          account_id: staffAdvancesAcct.id,
          debit: Number(amount),
          credit: 0,
          description,
        },
        {
          journal_entry_id: je.id,
          account_id: bank_account_id,
          debit: 0,
          credit: Number(amount),
          description,
        },
      ])

    if (linesError) {
      console.error("JE lines insert error:", linesError)
      // Clean up the orphaned JE header
      await supabase.from("journal_entries").delete().eq("id", je.id)
      return NextResponse.json({ error: linesError.message }, { status: 500 })
    }

    // Insert salary advance record
    const { data: advance, error: advError } = await supabase
      .from("salary_advances")
      .insert({
        business_id: business.id,
        staff_id,
        amount: Number(amount),
        monthly_repayment: Number(monthly_repayment),
        date_issued,
        bank_account_id,
        journal_entry_id: je.id,
        notes: notes?.trim() || null,
      })
      .select()
      .single()

    if (advError) {
      console.error("Advance insert error:", advError)
      await supabase.from("journal_entries").delete().eq("id", je.id)
      return NextResponse.json(
        {
          success: false,
          error: advError.message || "Failed to save salary advance after posting journal entry. Journal entry was rolled back.",
        },
        { status: 500 }
      )
    }

    // Create recurring deduction for the staff member linked to this advance
    const { error: dedError } = await supabase
      .from("deductions")
      .insert({
        staff_id,
        type: "advance",
        amount: Number(monthly_repayment),
        recurring: true,
        description: `Advance repayment`,
        advance_id: advance.id,
      })

    if (dedError) {
      console.error("Deduction creation warning:", dedError)
      // Non-fatal: advance is recorded, JE is posted. Warn but don't fail.
      return NextResponse.json({
        success: true,
        journal_entry_id: je.id,
        advance,
        warning: "Advance issued but recurring deduction could not be set up automatically: " + dedError.message,
      })
    }

    return NextResponse.json({ success: true, journal_entry_id: je.id, advance })
  } catch (err: any) {
    console.error("Error in POST /api/payroll/advances:", err)
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 })
  }
}
