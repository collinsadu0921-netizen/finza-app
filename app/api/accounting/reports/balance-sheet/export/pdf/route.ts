import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { canUserInitializeAccounting } from "@/lib/accounting/bootstrap"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"
import { resolveAccountingPeriodForReport } from "@/lib/accounting/resolveAccountingPeriodForReport"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"

/**
 * GET /api/accounting/reports/balance-sheet/export/pdf
 * 
 * Exports Balance Sheet as PDF.
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
    const rangeStart = searchParams.get("start_date")
    const rangeEnd = searchParams.get("end_date")
    const hasCustomRange =
      !!(rangeStart?.trim() && rangeEnd?.trim() && /^\d{4}-\d{2}-\d{2}$/.test(rangeStart.trim()) && /^\d{4}-\d{2}-\d{2}$/.test(rangeEnd.trim()))
    const asOfDateRaw = searchParams.get("as_of_date")
    const asOfDate =
      hasCustomRange
        ? null
        : asOfDateRaw?.trim() ||
          (periodStart?.trim() ? null : new Date().toISOString().split("T")[0])

    try {
      assertAccountingAccess(accountingUserFromRequest(request))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Forbidden"
      return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 403 })
    }

    const resolved = await resolveAccountingContext({
      supabase,
      userId: user.id,
      searchParams,
      pathname: new URL(request.url).pathname,
      source: "api",
    })
    if ("error" in resolved) {
      return NextResponse.json(
        { error: "Missing required parameter: business_id" },
        { status: 400 }
      )
    }
    const resolvedBusinessId = resolved.businessId

    const auth = await checkAccountingAuthority(
      supabase,
      user.id,
      resolvedBusinessId,
      "read"
    )
    if (!auth.authorized) {
      return NextResponse.json(
        { error: "Unauthorized. Only admins, owners, or accountants can export balance sheet." },
        { status: 403 }
      )
    }

    if (!canUserInitializeAccounting(auth.authority_source)) {
      const { ready } = await checkAccountingReadiness(supabase, resolvedBusinessId)
      if (!ready) {
        return NextResponse.json(
          { error: "ACCOUNTING_NOT_READY", business_id: resolvedBusinessId, authority_source: auth.authority_source },
          { status: 403 }
        )
      }
    } else {
      await supabase.rpc("create_system_accounts", { p_business_id: resolvedBusinessId })
    }

    const { period: resolvedPeriod, error: resolveError } = await resolveAccountingPeriodForReport(
      supabase,
      {
        businessId: resolvedBusinessId,
        period_id: periodId,
        period_start: periodStart,
        as_of_date: asOfDate,
        start_date: hasCustomRange ? rangeStart!.trim() : null,
        end_date: hasCustomRange ? rangeEnd!.trim() : null,
      }
    )
    if (resolveError || !resolvedPeriod) {
      return NextResponse.json(
        { error: resolveError ?? "Accounting period could not be resolved. Provide period_id, period_start, or as_of_date." },
        { status: 500 }
      )
    }

    // Contract v2.0 — Statements sourced from snapshot TB
    const { data: balanceSheetData, error: rpcError } = await supabase.rpc("get_balance_sheet_from_trial_balance", {
      p_period_id: resolvedPeriod.period_id,
    })

    if (rpcError) {
      console.error("Error fetching balance sheet:", rpcError)
      return NextResponse.json(
        { error: rpcError.message || "Failed to fetch balance sheet" },
        { status: 500 }
      )
    }

    // Safety limit: PDF max 5,000 rows
    const rowCount = balanceSheetData?.length || 0
    if (rowCount > 5000) {
      return NextResponse.json(
        { error: `Balance sheet has ${rowCount} rows, which exceeds the maximum PDF export limit of 5,000 rows. Please use CSV export instead.` },
        { status: 400 }
      )
    }

    // Separate by type
    type BalanceRow = { account_type?: string; balance?: number | null; period_total?: number | null }
    const assets = (balanceSheetData || []).filter((acc: BalanceRow) => acc.account_type === "asset")
    const liabilities = (balanceSheetData || []).filter((acc: BalanceRow) => acc.account_type === "liability")
    const equity = (balanceSheetData || []).filter((acc: BalanceRow) => acc.account_type === "equity")

    // Calculate totals
    const totalAssets = assets.reduce((sum: number, acc: BalanceRow) => sum + Number(acc.balance || 0), 0)
    const totalLiabilities = liabilities.reduce((sum: number, acc: BalanceRow) => sum + Number(acc.balance || 0), 0)
    const totalEquity = equity.reduce((sum: number, acc: BalanceRow) => sum + Number(acc.balance || 0), 0)

    // Calculate current period net income when period_start provided (Contract v2.0 — snapshot P&L)
    let currentPeriodNetIncome = 0
    if (periodStart) {
      const { data: pnlData } = await supabase.rpc("get_profit_and_loss_from_trial_balance", {
        p_period_id: resolvedPeriod.period_id,
      })
      if (pnlData && pnlData.length > 0) {
        const incomeTotal = (pnlData || [])
          .filter((acc: BalanceRow) => acc.account_type === "income")
          .reduce((sum: number, acc: BalanceRow) => sum + Number(acc.period_total || 0), 0)
        const expenseTotal = (pnlData || [])
          .filter((acc: BalanceRow) => acc.account_type === "expense")
          .reduce((sum: number, acc: BalanceRow) => sum + Number(acc.period_total || 0), 0)
        currentPeriodNetIncome = incomeTotal - expenseTotal
      }
    }

    const adjustedEquity = totalEquity + currentPeriodNetIncome
    const totalLiabilitiesAndEquity = totalLiabilities + adjustedEquity
    const balancingDifference = totalAssets - totalLiabilitiesAndEquity
    const isBalanced = Math.abs(balancingDifference) < 0.01

    // Generate PDF (simplified - similar structure to trial balance)
    const PDFDocument = (await import("pdfkit")).default
    const doc = new PDFDocument({ margin: 50 })

    // Collect PDF chunks
    const chunks: Buffer[] = []
    doc.on("data", (chunk: Buffer) => {
      chunks.push(chunk)
    })

    // Title
    doc.fontSize(18).font("Helvetica-Bold").text("Balance Sheet Report", { align: "center" })
    doc.moveDown(0.5)

    // Subheader
    const { data: business } = await supabase
      .from("businesses")
      .select("name")
      .eq("id", resolvedBusinessId)
      .single()
    
    doc.fontSize(12).font("Helvetica").text(`${business?.name || "Business"} — As of ${asOfDate}`, { align: "center" })
    doc.moveDown(1)

    const columnWidths = [80, 300, 120] // Code, Name, Balance
    const rowHeight = 25
    let x = 50
    let y = doc.y

    // Assets section
    doc.fontSize(12).font("Helvetica-Bold").text("ASSETS", 50, y)
    doc.moveDown(0.5)
    y = doc.y

    doc.fontSize(10).font("Helvetica-Bold")
    x = 50
    const headers = ["Account Code", "Account Name", "Balance"]
    headers.forEach((header, i) => {
      doc.rect(x, y, columnWidths[i], rowHeight).stroke()
      doc.text(header, x + 5, y + 7, { width: columnWidths[i] - 10, align: i === 2 ? "right" : "left" })
      x += columnWidths[i]
    })
    y += rowHeight

    doc.fontSize(9).font("Helvetica")
    if (assets.length === 0) {
      doc.text("No asset accounts with balances", x, y)
      y += rowHeight
    } else {
      for (const account of assets) {
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
        doc.text(formatNumeric(account.balance || 0), x + 5, y + 7, { width: columnWidths[2] - 10, align: "right" })
        y += rowHeight
      }
    }

    // Total Assets
    if (y + rowHeight > doc.page.height - 50) {
      doc.addPage()
      y = 50
    }
    doc.fontSize(10).font("Helvetica-Bold")
    x = 50
    doc.rect(x, y, columnWidths[0] + columnWidths[1], rowHeight).fillAndStroke("#F0F0F0", "#000000")
    doc.text("Total Assets", x + 5, y + 7, { width: columnWidths[0] + columnWidths[1] - 10 })
    x += columnWidths[0] + columnWidths[1]
    doc.rect(x, y, columnWidths[2], rowHeight).fillAndStroke("#F0F0F0", "#000000")
    doc.text(formatNumeric(totalAssets), x + 5, y + 7, { width: columnWidths[2] - 10, align: "right" })
    y += rowHeight + 10

    // Liabilities section
    doc.fontSize(12).font("Helvetica-Bold").text("LIABILITIES", 50, y)
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
    if (liabilities.length === 0) {
      doc.text("No liability accounts with balances", x, y)
      y += rowHeight
    } else {
      for (const account of liabilities) {
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
        doc.text(formatNumeric(account.balance || 0), x + 5, y + 7, { width: columnWidths[2] - 10, align: "right" })
        y += rowHeight
      }
    }

    // Total Liabilities
    if (y + rowHeight > doc.page.height - 50) {
      doc.addPage()
      y = 50
    }
    doc.fontSize(10).font("Helvetica-Bold")
    x = 50
    doc.rect(x, y, columnWidths[0] + columnWidths[1], rowHeight).fillAndStroke("#F0F0F0", "#000000")
    doc.text("Total Liabilities", x + 5, y + 7, { width: columnWidths[0] + columnWidths[1] - 10 })
    x += columnWidths[0] + columnWidths[1]
    doc.rect(x, y, columnWidths[2], rowHeight).fillAndStroke("#F0F0F0", "#000000")
    doc.text(formatNumeric(totalLiabilities), x + 5, y + 7, { width: columnWidths[2] - 10, align: "right" })
    y += rowHeight + 10

    // Equity section
    doc.fontSize(12).font("Helvetica-Bold").text("EQUITY", 50, y)
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
    if (equity.length === 0) {
      doc.text("No equity accounts with balances", x, y)
      y += rowHeight
    } else {
      for (const account of equity) {
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
        doc.text(formatNumeric(account.balance || 0), x + 5, y + 7, { width: columnWidths[2] - 10, align: "right" })
        y += rowHeight
      }
    }

    // Total Equity
    if (y + rowHeight > doc.page.height - 50) {
      doc.addPage()
      y = 50
    }
    doc.fontSize(10).font("Helvetica-Bold")
    x = 50
    doc.rect(x, y, columnWidths[0] + columnWidths[1], rowHeight).fillAndStroke("#F0F0F0", "#000000")
    doc.text("Total Equity", x + 5, y + 7, { width: columnWidths[0] + columnWidths[1] - 10 })
    x += columnWidths[0] + columnWidths[1]
    doc.rect(x, y, columnWidths[2], rowHeight).fillAndStroke("#F0F0F0", "#000000")
    doc.text(formatNumeric(totalEquity), x + 5, y + 7, { width: columnWidths[2] - 10, align: "right" })
    y += rowHeight

    // Current Period Net Income (if provided)
    if (periodStart && currentPeriodNetIncome !== 0) {
      if (y + rowHeight > doc.page.height - 50) {
        doc.addPage()
        y = 50
      }
      x = 50
      doc.rect(x, y, columnWidths[0] + columnWidths[1], rowHeight).fillAndStroke("#E0E0E0", "#000000")
      doc.text("Current Period Net Income", x + 5, y + 7, { width: columnWidths[0] + columnWidths[1] - 10 })
      x += columnWidths[0] + columnWidths[1]
      doc.rect(x, y, columnWidths[2], rowHeight).fillAndStroke("#E0E0E0", "#000000")
      doc.text(formatNumeric(currentPeriodNetIncome), x + 5, y + 7, { width: columnWidths[2] - 10, align: "right" })
      y += rowHeight

      if (y + rowHeight > doc.page.height - 50) {
        doc.addPage()
        y = 50
      }
      x = 50
      doc.rect(x, y, columnWidths[0] + columnWidths[1], rowHeight).fillAndStroke("#D0D0D0", "#000000")
      doc.text("Adjusted Total Equity", x + 5, y + 7, { width: columnWidths[0] + columnWidths[1] - 10 })
      x += columnWidths[0] + columnWidths[1]
      doc.rect(x, y, columnWidths[2], rowHeight).fillAndStroke("#D0D0D0", "#000000")
      doc.text(formatNumeric(adjustedEquity), x + 5, y + 7, { width: columnWidths[2] - 10, align: "right" })
      y += rowHeight
    }

    // Summary
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
    doc.text("Total Assets", x + 5, y + 7, { width: columnWidths[0] + columnWidths[1] - 10 })
    x += columnWidths[0] + columnWidths[1]
    doc.rect(x, y, columnWidths[2], rowHeight).fillAndStroke("#E0E0E0", "#000000")
    doc.text(formatNumeric(totalAssets), x + 5, y + 7, { width: columnWidths[2] - 10, align: "right" })
    y += rowHeight

    x = 50
    doc.rect(x, y, columnWidths[0] + columnWidths[1], rowHeight).fillAndStroke("#E0E0E0", "#000000")
    doc.text("Total Liabilities + Equity", x + 5, y + 7, { width: columnWidths[0] + columnWidths[1] - 10 })
    x += columnWidths[0] + columnWidths[1]
    doc.rect(x, y, columnWidths[2], rowHeight).fillAndStroke("#E0E0E0", "#000000")
    doc.text(formatNumeric(totalLiabilitiesAndEquity), x + 5, y + 7, { width: columnWidths[2] - 10, align: "right" })
    y += rowHeight

    doc.fontSize(9).font("Helvetica")
    doc.text(`Balancing Difference: ${formatNumeric(balancingDifference)}`, 50, y)
    doc.text(`Is Balanced: ${isBalanced ? "Yes" : "No"}`, 50, y + 15)

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

    const filename = `balance-sheet-as-of-${asOfDate}.pdf`

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    })
  } catch (error: any) {
    console.error("Error exporting balance sheet PDF:", error)
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
