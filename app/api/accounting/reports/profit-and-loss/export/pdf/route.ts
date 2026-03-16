import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"
import { canUserInitializeAccounting } from "@/lib/accountingBootstrap"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"
import { resolveAccountingPeriodForReport } from "@/lib/accounting/resolveAccountingPeriodForReport"

/**
 * GET /api/accounting/reports/profit-and-loss/export/pdf
 * 
 * Exports Profit & Loss as PDF.
 * Contract v2.0 — Statements sourced from snapshot TB
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
        { error: "Unauthorized. Only admins, owners, or accountants can export profit & loss." },
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

    const { period: resolvedPeriod, error: resolveError } = await resolveAccountingPeriodForReport(
      supabase,
      { businessId, period_id: periodId, period_start: periodStart, as_of_date: asOfDate, start_date: startDate, end_date: endDate }
    )
    if (resolveError || !resolvedPeriod) {
      return NextResponse.json(
        { error: resolveError ?? "Accounting period could not be resolved. Provide period_id, period_start, as_of_date, or start_date and end_date." },
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

    // Contract v2.0 — Statements sourced from snapshot TB
    const { data: pnlData, error: rpcError } = await supabase.rpc("get_profit_and_loss_from_trial_balance", {
      p_period_id: resolvedPeriod.period_id,
    })

    if (rpcError) {
      console.error("Error fetching profit & loss:", rpcError)
      return NextResponse.json(
        { error: rpcError.message || "Failed to fetch profit & loss" },
        { status: 500 }
      )
    }

    // Safety limit: PDF max 5,000 rows
    const rowCount = pnlData?.length || 0
    if (rowCount > 5000) {
      return NextResponse.json(
        { error: `Profit & Loss has ${rowCount} rows, which exceeds the maximum PDF export limit of 5,000 rows. Please use CSV export instead or use a smaller date range.` },
        { status: 400 }
      )
    }

    // Generate PDF (simplified - similar structure to trial balance)
    const PDFDocument = (await import("pdfkit")).default
    const doc = new PDFDocument({ margin: 50 })

    // Collect PDF chunks
    const chunks: Buffer[] = []
    doc.on("data", (chunk: Buffer) => {
      chunks.push(chunk)
    })

    // Title
    doc.fontSize(18).font("Helvetica-Bold").text("Profit & Loss Report", { align: "center" })
    doc.moveDown(0.5)

    // Subheader
    const { data: business } = await supabase
      .from("businesses")
      .select("name")
      .eq("id", businessId)
      .single()
    
    const periodLabel = resolvedPeriod.resolution_reason === "period_id" || periodStart
      ? `Period: ${effectiveStartDate} to ${effectiveEndDate}`
      : `Date Range: ${effectiveStartDate} to ${effectiveEndDate}`
    doc.fontSize(12).font("Helvetica").text(`${business?.name || "Business"} — ${periodLabel}`, { align: "center" })
    doc.moveDown(1)

    // Separate income and expense accounts
    const incomeAccounts = (pnlData || []).filter((acc) => acc.account_type === "income")
    const expenseAccounts = (pnlData || []).filter((acc) => acc.account_type === "expense")

    // Calculate totals
    const totalRevenue = incomeAccounts.reduce((sum, acc) => sum + Number(acc.period_total || 0), 0)
    const totalExpenses = expenseAccounts.reduce((sum, acc) => sum + Number(acc.period_total || 0), 0)
    const netProfit = totalRevenue - totalExpenses

    // Revenue section
    doc.fontSize(12).font("Helvetica-Bold").text("REVENUE (INCOME)", 50, doc.y)
    doc.moveDown(0.5)

    const columnWidths = [80, 300, 120] // Code, Name, Total
    const rowHeight = 25
    let x = 50
    let y = doc.y

    doc.fontSize(10).font("Helvetica-Bold")
    const headers = ["Account Code", "Account Name", "Period Total"]
    headers.forEach((header, i) => {
      doc.rect(x, y, columnWidths[i], rowHeight).stroke()
      doc.text(header, x + 5, y + 7, { width: columnWidths[i] - 10, align: i === 2 ? "right" : "left" })
      x += columnWidths[i]
    })
    y += rowHeight

    doc.fontSize(9).font("Helvetica")
    if (incomeAccounts.length === 0) {
      doc.text("No revenue accounts with activity in this period", x, y)
      y += rowHeight
    } else {
      for (const account of incomeAccounts) {
        x = 50
        if (y + rowHeight > doc.page.height - 50) {
          doc.addPage()
          y = 50
        }
        doc.rect(x, y, columnWidths[0], rowHeight).stroke()
        doc.text(account.account_code || "", x + 5, y + 7, { width: columnWidths[0] - 10 })
        x += columnWidths[0]
        doc.rect(x, y, columnWidths[1], rowHeight).stroke()
        doc.text(account.account_name || "", x + 5, y + 7, { width: columnWidths[1] - 10 })
        x += columnWidths[1]
        doc.rect(x, y, columnWidths[2], rowHeight).stroke()
        doc.text(formatNumeric(account.period_total || 0), x + 5, y + 7, { width: columnWidths[2] - 10, align: "right" })
        y += rowHeight
      }
    }

    // Total Revenue
    if (y + rowHeight > doc.page.height - 50) {
      doc.addPage()
      y = 50
    }
    doc.fontSize(10).font("Helvetica-Bold")
    x = 50
    doc.rect(x, y, columnWidths[0] + columnWidths[1], rowHeight).fillAndStroke("#F0F0F0", "#000000")
    doc.text("Total Revenue", x + 5, y + 7, { width: columnWidths[0] + columnWidths[1] - 10 })
    x += columnWidths[0] + columnWidths[1]
    doc.rect(x, y, columnWidths[2], rowHeight).fillAndStroke("#F0F0F0", "#000000")
    doc.text(formatNumeric(totalRevenue), x + 5, y + 7, { width: columnWidths[2] - 10, align: "right" })
    y += rowHeight + 10

    // Expenses section
    doc.fontSize(12).font("Helvetica-Bold").text("EXPENSES", 50, y)
    doc.moveDown(0.5)
    y = doc.y

    doc.fontSize(10).font("Helvetica-Bold")
    x = 50
    headers.forEach((header, i) => {
      doc.rect(x, y, columnWidths[i], rowHeight).stroke()
      doc.text(header, x + 5, y + 7, { width: columnWidths[i] - 10, align: i === 2 ? "right" : "left" })
      x += columnWidths[i]
    })
    y += rowHeight

    doc.fontSize(9).font("Helvetica")
    if (expenseAccounts.length === 0) {
      doc.text("No expense accounts with activity in this period", x, y)
      y += rowHeight
    } else {
      for (const account of expenseAccounts) {
        x = 50
        if (y + rowHeight > doc.page.height - 50) {
          doc.addPage()
          y = 50
        }
        doc.rect(x, y, columnWidths[0], rowHeight).stroke()
        doc.text(account.account_code || "", x + 5, y + 7, { width: columnWidths[0] - 10 })
        x += columnWidths[0]
        doc.rect(x, y, columnWidths[1], rowHeight).stroke()
        doc.text(account.account_name || "", x + 5, y + 7, { width: columnWidths[1] - 10 })
        x += columnWidths[1]
        doc.rect(x, y, columnWidths[2], rowHeight).stroke()
        doc.text(formatNumeric(account.period_total || 0), x + 5, y + 7, { width: columnWidths[2] - 10, align: "right" })
        y += rowHeight
      }
    }

    // Total Expenses
    if (y + rowHeight > doc.page.height - 50) {
      doc.addPage()
      y = 50
    }
    doc.fontSize(10).font("Helvetica-Bold")
    x = 50
    doc.rect(x, y, columnWidths[0] + columnWidths[1], rowHeight).fillAndStroke("#F0F0F0", "#000000")
    doc.text("Total Expenses", x + 5, y + 7, { width: columnWidths[0] + columnWidths[1] - 10 })
    x += columnWidths[0] + columnWidths[1]
    doc.rect(x, y, columnWidths[2], rowHeight).fillAndStroke("#F0F0F0", "#000000")
    doc.text(formatNumeric(totalExpenses), x + 5, y + 7, { width: columnWidths[2] - 10, align: "right" })
    y += rowHeight + 10

    // Net Profit/Loss
    doc.fontSize(12).font("Helvetica-Bold").text("SUMMARY", 50, y)
    doc.moveDown(0.5)
    y = doc.y

    if (y + rowHeight * 3 > doc.page.height - 50) {
      doc.addPage()
      y = 50
    }

    doc.fontSize(10).font("Helvetica-Bold")
    x = 50
    doc.rect(x, y, columnWidths[0] + columnWidths[1], rowHeight).fillAndStroke("#E0E0E0", "#000000")
    doc.text("Total Revenue", x + 5, y + 7, { width: columnWidths[0] + columnWidths[1] - 10 })
    x += columnWidths[0] + columnWidths[1]
    doc.rect(x, y, columnWidths[2], rowHeight).fillAndStroke("#E0E0E0", "#000000")
    doc.text(formatNumeric(totalRevenue), x + 5, y + 7, { width: columnWidths[2] - 10, align: "right" })
    y += rowHeight

    x = 50
    doc.rect(x, y, columnWidths[0] + columnWidths[1], rowHeight).fillAndStroke("#E0E0E0", "#000000")
    doc.text("Total Expenses", x + 5, y + 7, { width: columnWidths[0] + columnWidths[1] - 10 })
    x += columnWidths[0] + columnWidths[1]
    doc.rect(x, y, columnWidths[2], rowHeight).fillAndStroke("#E0E0E0", "#000000")
    doc.text(formatNumeric(totalExpenses), x + 5, y + 7, { width: columnWidths[2] - 10, align: "right" })
    y += rowHeight

    x = 50
    doc.rect(x, y, columnWidths[0] + columnWidths[1], rowHeight).fillAndStroke("#D0D0D0", "#000000")
    doc.text("Net Profit / Loss", x + 5, y + 7, { width: columnWidths[0] + columnWidths[1] - 10 })
    x += columnWidths[0] + columnWidths[1]
    doc.rect(x, y, columnWidths[2], rowHeight).fillAndStroke("#D0D0D0", "#000000")
    doc.text(formatNumeric(netProfit), x + 5, y + 7, { width: columnWidths[2] - 10, align: "right" })

    // Footer
    doc.on("pageAdded", () => {
      const pageHeight = doc.page.height
      doc.fontSize(8).font("Helvetica")
      doc.text(`Generated on ${new Date().toISOString()}`, 50, pageHeight - 30, { align: "left" })
      doc.text("FINZA — Read-only report", doc.page.width - 50, pageHeight - 30, { align: "right" })
    })

    const pageHeight = doc.page.height
    doc.fontSize(8).font("Helvetica")
    doc.text(`Generated on ${new Date().toISOString()}`, 50, pageHeight - 30, { align: "left" })
    doc.text("FINZA — Read-only report", doc.page.width - 50, pageHeight - 30, { align: "right" })

    // Finalize
    doc.end()

    await new Promise<void>((resolve) => {
      doc.on("end", () => {
        resolve()
      })
    })

    const pdfBuffer = Buffer.concat(chunks)

    const periodLabelForFile = periodStart 
      ? `period-${periodStart}` 
      : `${effectiveStartDate}-to-${effectiveEndDate}`
    const filename = `profit-and-loss-${periodLabelForFile}.pdf`

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    })
  } catch (error: any) {
    console.error("Error exporting profit & loss PDF:", error)
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

function formatNumeric(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(Number(value))) {
    return "0.00"
  }
  return Number(value).toFixed(2)
}
