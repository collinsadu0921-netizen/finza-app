import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"

/**
 * GET /api/accounting/reports/general-ledger/export/pdf
 * 
 * Exports General Ledger as PDF
 * Ledger-only: Uses same get_general_ledger() function as on-screen report
 * 
 * Query Parameters:
 * - business_id (required)
 * - account_id (required)
 * - period_start (optional) - if provided, use period_start/period_end from accounting_periods
 * - start_date (optional) - if period_start not provided, use date range
 * - end_date (optional) - if period_start not provided, use date range
 * 
 * Access: Admin/Owner/Accountant (read or write)
 * 
 * PDF Format:
 * - Title: General Ledger Report
 * - Subheader: Account name + filters (period/date)
 * - Table with columns: Entry Date, Description, Debit, Credit, Running Balance
 * - Totals row at bottom
 * - Footer: Generated on <timestamp>, FINZA — Read-only report
 * 
 * Safety Limit: Max 5,000 rows (PDF limit)
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
    const accountId = searchParams.get("account_id")
    const periodStart = searchParams.get("period_start")
    const startDate = searchParams.get("start_date")
    const endDate = searchParams.get("end_date")

    if (!businessId || !accountId) {
      return NextResponse.json(
        { error: "Missing required parameters: business_id and account_id" },
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
        { error: "Unauthorized. Only admins, owners, or accountants can export general ledger." },
        { status: 403 }
      )
    }

    // Verify account exists
    const { data: account, error: accountError } = await supabase
      .from("accounts")
      .select("id, code, name, type")
      .eq("id", accountId)
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .single()

    if (accountError || !account) {
      return NextResponse.json(
        { error: "Account not found or does not belong to business" },
        { status: 404 }
      )
    }

    // Determine date range
    let effectiveStartDate: string
    let effectiveEndDate: string

    if (periodStart) {
      let { data: period, error: periodError } = await supabase
        .from("accounting_periods")
        .select("period_start, period_end")
        .eq("business_id", businessId)
        .eq("period_start", periodStart)
        .single()

      if (periodError || !period) {
        const periodDate = periodStart.length === 7 ? `${periodStart}-01` : periodStart
        const { error: ensureError } = await supabase.rpc("ensure_accounting_period", {
          p_business_id: businessId,
          p_date: periodDate,
        })
        if (ensureError) {
          console.error("ensure_accounting_period failed:", ensureError)
          return NextResponse.json({ error: "Accounting period could not be resolved" }, { status: 500 })
        }
        const refetch = await supabase
          .from("accounting_periods")
          .select("period_start, period_end")
          .eq("business_id", businessId)
          .eq("period_start", periodDate)
          .single()
        if (refetch.error || !refetch.data) {
          return NextResponse.json({ error: "Accounting period could not be resolved" }, { status: 500 })
        }
        period = refetch.data
      }

      effectiveStartDate = period.period_start
      effectiveEndDate = period.period_end
    } else if (startDate && endDate) {
      effectiveStartDate = startDate
      effectiveEndDate = endDate
    } else {
      return NextResponse.json(
        { error: "Either period_start or both start_date and end_date must be provided" },
        { status: 400 }
      )
    }

    // Validate date range
    const start = new Date(effectiveStartDate)
    const end = new Date(effectiveEndDate)
    const yearsDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365)
    if (yearsDiff > 10) {
      return NextResponse.json(
        { error: "Date range cannot exceed 10 years. Please select a smaller range." },
        { status: 400 }
      )
    }

    // Fetch data (non-paginated for export)
    const { data: ledgerLines, error: rpcError } = await supabase.rpc("get_general_ledger", {
      p_business_id: businessId,
      p_account_id: accountId,
      p_start_date: effectiveStartDate,
      p_end_date: effectiveEndDate,
    })

    if (rpcError) {
      console.error("Error fetching general ledger:", rpcError)
      return NextResponse.json(
        { error: rpcError.message || "Failed to fetch general ledger" },
        { status: 500 }
      )
    }

    // Safety limit: PDF max 5,000 rows
    const rowCount = ledgerLines?.length || 0
    if (rowCount > 5000) {
      return NextResponse.json(
        { error: `General ledger has ${rowCount} rows, which exceeds the maximum PDF export limit of 5,000 rows. Please use CSV export instead or use a smaller date range.` },
        { status: 400 }
      )
    }

    // Generate PDF
    const PDFDocument = (await import("pdfkit")).default
    const doc = new PDFDocument({ margin: 50 })

    // Collect PDF chunks - set up listener BEFORE adding any content
    const chunks: Buffer[] = []
    doc.on("data", (chunk: Buffer) => {
      chunks.push(chunk)
    })

    // Title
    doc.fontSize(18).font("Helvetica-Bold").text("General Ledger Report", { align: "center" })
    doc.moveDown(0.5)

    // Subheader
    const periodLabel = periodStart 
      ? `Period: ${periodStart}` 
      : `Date Range: ${effectiveStartDate} to ${effectiveEndDate}`
    doc.fontSize(12).font("Helvetica").text(`${account.code} - ${account.name} — ${periodLabel}`, { align: "center" })
    doc.moveDown(1)

    // Table headers
    const columnWidths = [90, 200, 100, 100, 110] // Date, Description, Debit, Credit, Running Balance
    const rowHeight = 25
    let x = 50
    let y = doc.y

    doc.fontSize(10).font("Helvetica-Bold")
    const headers = ["Entry Date", "Description", "Debit", "Credit", "Running Balance"]
    headers.forEach((header: string, i: number) => {
      doc.rect(x, y, columnWidths[i], rowHeight).stroke()
      doc.text(header, x + 5, y + 7, { width: columnWidths[i] - 10, align: i >= 2 ? "right" : "left" })
      x += columnWidths[i]
    })
    y += rowHeight

    // Table rows
    doc.fontSize(9).font("Helvetica")
    if (ledgerLines && ledgerLines.length > 0) {
      for (const line of ledgerLines) {
        x = 50
        if (y + rowHeight > doc.page.height - 50) {
          doc.addPage()
          y = 50
        }

        const description = line.journal_entry_description || line.line_description || ""
        const cells = [
          line.entry_date ? new Date(line.entry_date).toLocaleDateString() : "",
          description.substring(0, 40), // Truncate long descriptions
          formatNumeric(line.debit || 0),
          formatNumeric(line.credit || 0),
          formatNumeric(line.running_balance || 0),
        ]

        cells.forEach((cell: string | number, i: number) => {
          doc.rect(x, y, columnWidths[i], rowHeight).stroke()
          doc.text(String(cell), x + 5, y + 7, { width: columnWidths[i] - 10, align: i >= 2 ? "right" : "left" })
          x += columnWidths[i]
        })
        y += rowHeight
      }
    }

    // Totals row
    const totalDebit = ledgerLines?.reduce((sum: number, line: any) => sum + Number(line.debit || 0), 0) || 0
    const totalCredit = ledgerLines?.reduce((sum: number, line: any) => sum + Number(line.credit || 0), 0) || 0
    const finalBalance = ledgerLines && ledgerLines.length > 0 
      ? Number(ledgerLines[ledgerLines.length - 1].running_balance || 0)
      : 0

    if (y + rowHeight > doc.page.height - 50) {
      doc.addPage()
      y = 50
    }

    doc.fontSize(10).font("Helvetica-Bold")
    x = 50
    doc.rect(x, y, columnWidths[0] + columnWidths[1], rowHeight).fillAndStroke("#F0F0F0", "#000000")
    doc.text("Totals", x + 5, y + 7, { width: columnWidths[0] + columnWidths[1] - 10, align: "left" })
    x += columnWidths[0] + columnWidths[1]
    doc.rect(x, y, columnWidths[2], rowHeight).fillAndStroke("#F0F0F0", "#000000")
    doc.text(formatNumeric(totalDebit), x + 5, y + 7, { width: columnWidths[2] - 10, align: "right" })
    x += columnWidths[2]
    doc.rect(x, y, columnWidths[3], rowHeight).fillAndStroke("#F0F0F0", "#000000")
    doc.text(formatNumeric(totalCredit), x + 5, y + 7, { width: columnWidths[3] - 10, align: "right" })
    x += columnWidths[3]
    doc.rect(x, y, columnWidths[4], rowHeight).fillAndStroke("#F0F0F0", "#000000")
    doc.text(formatNumeric(finalBalance), x + 5, y + 7, { width: columnWidths[4] - 10, align: "right" })

    // Footer on each page
    doc.on("pageAdded", () => {
      const pageHeight = doc.page.height
      doc.fontSize(8).font("Helvetica")
      doc.text(`Generated on ${new Date().toISOString()}`, 50, pageHeight - 30, { align: "left" })
      doc.text("FINZA — Read-only report", doc.page.width - 50, pageHeight - 30, { align: "right" })
    })

    // Footer on current page
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
    const filename = `general-ledger-${account.code}-${periodLabelForFile}.pdf`

    // Return PDF file
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    })
  } catch (error: any) {
    console.error("Error exporting general ledger PDF:", error)
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
