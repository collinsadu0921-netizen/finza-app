import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"
import { canUserInitializeAccounting } from "@/lib/accountingBootstrap"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"
import { resolveAccountingPeriodForReport } from "@/lib/accounting/resolveAccountingPeriodForReport"

/**
 * GET /api/accounting/reports/trial-balance/export/pdf
 * Exports Trial Balance as PDF. Period resolved server-side via universal resolver.
 * Query: business_id (required), period_id | period_start | as_of_date | start_date/end_date (optional).
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

    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")
    const periodId = searchParams.get("period_id")
    const periodStart = searchParams.get("period_start")
    const asOfDate = searchParams.get("as_of_date")
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")

    if (!businessId) {
      return NextResponse.json(
        { error: "Missing required parameter: business_id" },
        { status: 400 }
      )
    }

    const auth = await checkAccountingAuthority(
      supabase,
      user.id,
      businessId,
      "read"
    )
    if (!auth.authorized) {
      return NextResponse.json(
        { error: "Unauthorized. Only admins, owners, or accountants can export trial balance." },
        { status: 403 }
      )
    }

    if (!canUserInitializeAccounting(auth.authority_source)) {
      const { ready } = await checkAccountingReadiness(supabase, businessId)
      if (!ready) {
        return NextResponse.json(
          { error: "ACCOUNTING_NOT_READY", business_id: businessId, authority_source: auth.authority_source },
          { status: 403 }
        )
      }
    } else {
      await supabase.rpc("create_system_accounts", { p_business_id: businessId })
    }

    const { data: business } = await supabase
      .from("businesses")
      .select("name")
      .eq("id", businessId)
      .single()

    const { period: resolvedPeriod, error: resolveError } = await resolveAccountingPeriodForReport(
      supabase,
      { businessId, period_id: periodId, period_start: periodStart, as_of_date: asOfDate, start_date: startDate, end_date: endDate }
    )
    if (resolveError || !resolvedPeriod) {
      return NextResponse.json(
        { error: resolveError ?? "Accounting period could not be resolved" },
        { status: 500 }
      )
    }

    const effectiveStartDate = resolvedPeriod.period_start
    const effectiveEndDate = resolvedPeriod.period_end

    // Validate date range (reject absurd ranges > 10 years)
    const start = new Date(effectiveStartDate)
    const end = new Date(effectiveEndDate)
    const yearsDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365)
    if (yearsDiff > 10) {
      return NextResponse.json(
        { error: "Date range cannot exceed 10 years. Please select a smaller range." },
        { status: 400 }
      )
    }

    // Canonical TB source per Contract v2.0 — Snapshot Authority
    const { data: trialBalance, error: rpcError } = await supabase.rpc("get_trial_balance_from_snapshot", {
      p_period_id: resolvedPeriod.period_id,
    })

    if (rpcError) {
      console.error("Error fetching trial balance:", rpcError)
      return NextResponse.json(
        { error: rpcError.message || "Failed to fetch trial balance" },
        { status: 500 }
      )
    }

    // Safety limit: PDF max 5,000 rows
    const rowCount = trialBalance?.length || 0
    if (rowCount > 5000) {
      return NextResponse.json(
        { error: `Trial balance has ${rowCount} rows, which exceeds the maximum PDF export limit of 5,000 rows. Please use CSV export instead or use a smaller date range.` },
        { status: 400 }
      )
    }

    // Generate PDF
    const PDFDocument = (await import("pdfkit")).default
    const doc = new PDFDocument({ margin: 50 })

    // Collect PDF chunks - set up listener early
    const chunks: Buffer[] = []
    doc.on("data", (chunk: Buffer) => {
      chunks.push(chunk)
    })

    // Title
    doc.fontSize(18).font("Helvetica-Bold").text("Trial Balance Report", { align: "center" })
    doc.moveDown(0.5)

    // Subheader
    const businessName = business?.name || "Business"
    const periodLabel = `Period: ${resolvedPeriod.period_start} to ${resolvedPeriod.period_end}`
    doc.fontSize(12).font("Helvetica").text(`${businessName} — ${periodLabel}`, { align: "center" })
    doc.moveDown(1)

    // Table headers
    const columnWidths = [80, 180, 80, 100, 100, 100] // Account Code, Name, Type, Debit, Credit, Balance
    const rowHeight = 25
    let x = 50
    let y = doc.y

    doc.fontSize(10).font("Helvetica-Bold")
    const headers = ["Account Code", "Account Name", "Type", "Debit Total", "Credit Total", "Ending Balance"]
    headers.forEach((header: string, i: number) => {
      doc.rect(x, y, columnWidths[i], rowHeight).stroke()
      doc.text(header, x + 5, y + 7, { width: columnWidths[i] - 10, align: i >= 3 ? "right" : "left" })
      x += columnWidths[i]
    })
    y += rowHeight

    // Table rows
    doc.fontSize(9).font("Helvetica")
    if (trialBalance && trialBalance.length > 0) {
      for (const account of trialBalance) {
        x = 50
        if (y + rowHeight > doc.page.height - 50) {
          doc.addPage()
          y = 50
        }

        const cells = [
          account.account_code || "",
          account.account_name || "",
          account.account_type || "",
          formatNumeric(account.debit_total || 0),
          formatNumeric(account.credit_total || 0),
          formatNumeric(account.closing_balance ?? 0),
        ]

        cells.forEach((cell: string | number, i: number) => {
          doc.rect(x, y, columnWidths[i], rowHeight).stroke()
          doc.text(String(cell), x + 5, y + 7, { width: columnWidths[i] - 10, align: i >= 3 ? "right" : "left" })
          x += columnWidths[i]
        })
        y += rowHeight
      }
    }

    // Totals row
    const totalDebits = trialBalance?.reduce((sum: number, acc: any) => sum + Number(acc.debit_total || 0), 0) || 0
    const totalCredits = trialBalance?.reduce((sum: number, acc: any) => sum + Number(acc.credit_total || 0), 0) || 0
    const isBalanced = Math.abs(totalDebits - totalCredits) < 0.01

    if (y + rowHeight > doc.page.height - 50) {
      doc.addPage()
      y = 50
    }

    doc.fontSize(10).font("Helvetica-Bold")
    x = 50
    doc.rect(x, y, columnWidths[0] + columnWidths[1] + columnWidths[2], rowHeight).fillAndStroke("#F0F0F0", "#000000")
    doc.text("Totals", x + 5, y + 7, { width: columnWidths[0] + columnWidths[1] + columnWidths[2] - 10, align: "left" })
    x += columnWidths[0] + columnWidths[1] + columnWidths[2]
    doc.rect(x, y, columnWidths[3], rowHeight).fillAndStroke("#F0F0F0", "#000000")
    doc.text(formatNumeric(totalDebits), x + 5, y + 7, { width: columnWidths[3] - 10, align: "right" })
    x += columnWidths[3]
    doc.rect(x, y, columnWidths[4], rowHeight).fillAndStroke("#F0F0F0", "#000000")
    doc.text(formatNumeric(totalCredits), x + 5, y + 7, { width: columnWidths[4] - 10, align: "right" })
    x += columnWidths[4]
    doc.rect(x, y, columnWidths[5], rowHeight).fillAndStroke("#F0F0F0", "#000000")
    doc.text(formatNumeric(totalDebits - totalCredits), x + 5, y + 7, { width: columnWidths[5] - 10, align: "right" })
    y += rowHeight + 10

    // Balance check
    doc.fontSize(9).font("Helvetica")
    doc.text(`Balanced: ${isBalanced ? "Yes" : "No"}`, 50, y)

    // Footer on each page
    doc.on("pageAdded", () => {
      const pageHeight = doc.page.height
      doc.fontSize(8).font("Helvetica")
      doc.text(`Generated on ${new Date().toISOString()}`, 50, pageHeight - 30, { align: "left" })
      doc.text("FINZA — Read-only report", doc.page.width - 50, pageHeight - 30, { align: "right" })
    })

    // Footer on first page
    const pageHeight = doc.page.height
    doc.fontSize(8).font("Helvetica")
    doc.text(`Generated on ${new Date().toISOString()}`, 50, pageHeight - 30, { align: "left" })
    doc.text("FINZA — Read-only report", doc.page.width - 50, pageHeight - 30, { align: "right" })

    // Finalize PDF
    doc.end()

    // Wait for PDF to be fully generated
    await new Promise<void>((resolve) => {
      doc.on("end", () => {
        resolve()
      })
    })

    const pdfBuffer = Buffer.concat(chunks)

    // Generate filename
    const periodLabelForFile = periodStart 
      ? `period-${periodStart}` 
      : `${effectiveStartDate}-to-${effectiveEndDate}`
    const filename = `trial-balance-${periodLabelForFile}.pdf`

    // Return PDF file
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    })
  } catch (error: any) {
    console.error("Error exporting trial balance PDF:", error)
    if (error.message?.includes("Cannot find module")) {
      return NextResponse.json(
        { error: "PDF generation requires 'pdfkit' package. Please install it with: npm install pdfkit @types/pdfkit" },
        { status: 500 }
      )
    }
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

/**
 * Format numeric value for PDF (no currency symbols, 2 decimal places)
 */
function formatNumeric(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(Number(value))) {
    return "0.00"
  }
  return Number(value).toFixed(2)
}
