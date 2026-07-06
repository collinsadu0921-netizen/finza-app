import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { canUserInitializeAccounting } from "@/lib/accounting/bootstrap"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { getProfitAndLossReport } from "@/lib/accounting/reports/getProfitAndLossReport"
import { parsePnLReportQuery, toPnLExportView } from "@/lib/accounting/reports/pnlExportHelpers"
import { createPdfKitDocument } from "@/lib/pdf/createPdfKitDocument"

/**
 * GET /api/accounting/reports/profit-and-loss/export/pdf
 * 
 * Exports Profit & Loss as PDF.
 * Canonical source: getProfitAndLossReport (ledger period movement)
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
        { error: "Unauthorized. Only admins, owners, or accountants can export profit & loss." },
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

    const { data: reportData, error: reportError } = await getProfitAndLossReport(
      supabase,
      parsePnLReportQuery(resolvedBusinessId, searchParams)
    )
    if (reportError || !reportData) {
      return NextResponse.json(
        { error: reportError || "Failed to fetch profit & loss" },
        { status: 500 }
      )
    }

    const view = toPnLExportView(reportData)
    const {
      periodStart: effectiveStartDate,
      periodEnd: effectiveEndDate,
      incomeLines: incomeAccounts,
      expenseLines: expenseAccounts,
      totalRevenue,
      totalExpenses,
      netProfit,
      rowCount,
      resolutionReason,
    } = view

    const start = new Date(effectiveStartDate)
    const end = new Date(effectiveEndDate)
    const yearsDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365)
    if (yearsDiff > 10) {
      return NextResponse.json(
        { error: "Date range cannot exceed 10 years. Please select a smaller range." },
        { status: 400 }
      )
    }

    if (rowCount > 5000) {
      return NextResponse.json(
        { error: `Profit & Loss has ${rowCount} rows, which exceeds the maximum PDF export limit of 5,000 rows. Please use CSV export instead or use a smaller date range.` },
        { status: 400 }
      )
    }

    const pdfBuffer = await (async () => {
    const doc = await createPdfKitDocument({ margin: 50 })

    const chunks: Buffer[] = []
    doc.on("data", (chunk: Buffer) => {
      chunks.push(chunk)
    })

    const addFooter = () => {
      resetPdfTextState(doc)
      const pageHeight = doc.page.height
      doc.fontSize(8).font("Helvetica")
      doc.text(`Generated on ${new Date().toISOString()}`, PDF_MARGIN, pageHeight - 30, { align: "left" })
      doc.text("FINZA — Read-only report", PDF_MARGIN, pageHeight - 30, {
        width: doc.page.width - PDF_MARGIN * 2,
        align: "right",
      })
    }

    resetPdfTextState(doc)
    doc.fontSize(18).font("Helvetica-Bold").text("Profit & Loss Report", { align: "center" })
    doc.moveDown(0.5)

    const { data: business } = await supabase
      .from("businesses")
      .select("name")
      .eq("id", resolvedBusinessId)
      .single()

    const periodLabel =
      (resolutionReason === "period_id" || periodStart) && resolutionReason !== "date_range"
        ? `Period: ${effectiveStartDate} to ${effectiveEndDate}`
        : `Date Range: ${effectiveStartDate} to ${effectiveEndDate}`
    resetPdfTextState(doc)
    doc.fontSize(12).font("Helvetica").text(`${business?.name || "Business"} — ${periodLabel}`, {
      align: "center",
    })
    doc.moveDown(1)

    const layout = pnlTableLayout(doc)
    let y = doc.y

    y = drawAccountSection(
      doc,
      y,
      layout,
      "REVENUE (INCOME)",
      incomeAccounts,
      "No revenue accounts with activity in this period",
      "Total Revenue",
      totalRevenue,
      addFooter
    )

    y = drawAccountSection(
      doc,
      y,
      layout,
      "EXPENSES",
      expenseAccounts,
      "No expense accounts with activity in this period",
      "Total Expenses",
      totalExpenses,
      addFooter
    )

    y = ensurePageSpace(doc, y, (MIN_ROW_H + 4) * 4, addFooter)
    y = drawSectionHeading(doc, y, "SUMMARY")
    y = drawSubtotalRow(doc, y, layout, "Total Revenue", totalRevenue, "#E0E0E0")
    y = drawSubtotalRow(doc, y, layout, "Total Expenses", totalExpenses, "#E0E0E0")
    drawSubtotalRow(doc, y, layout, "Net Profit / Loss", netProfit, "#D0D0D0")

    addFooter()

    doc.end()

    await new Promise<void>((resolve) => {
      doc.on("end", () => {
        resolve()
      })
    })

    return Buffer.concat(chunks)
    })()

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

type PnlPdfDoc = Awaited<ReturnType<typeof createPdfKitDocument>>

const PDF_MARGIN = 50
const PDF_BOTTOM_RESERVE = 55
const CELL_PAD_X = 6
const CELL_PAD_Y = 6
const MIN_ROW_H = 22

function resetPdfTextState(doc: PnlPdfDoc) {
  doc.fillColor("black")
  doc.strokeColor("black")
  doc.opacity(1)
}

function pnlTableLayout(doc: PnlPdfDoc) {
  const left = PDF_MARGIN
  const tableWidth = doc.page.width - PDF_MARGIN * 2
  const codeWidth = 72
  const totalWidth = 88
  const nameWidth = tableWidth - codeWidth - totalWidth
  return {
    left,
    tableWidth,
    columnWidths: [codeWidth, nameWidth, totalWidth] as [number, number, number],
  }
}

function rowHeightForText(doc: PnlPdfDoc, text: string, width: number, min = MIN_ROW_H): number {
  const inner = Math.max(1, width - CELL_PAD_X * 2)
  const h = doc.heightOfString(text, { width: inner })
  return Math.max(min, h + CELL_PAD_Y * 2)
}

function ensurePageSpace(
  doc: PnlPdfDoc,
  y: number,
  needed: number,
  addFooter: () => void
): number {
  if (y + needed > doc.page.height - PDF_BOTTOM_RESERVE) {
    addFooter()
    doc.addPage()
    return PDF_MARGIN
  }
  return y
}

function drawSectionHeading(doc: PnlPdfDoc, y: number, title: string): number {
  resetPdfTextState(doc)
  doc.fontSize(12).font("Helvetica-Bold")
  const width = doc.page.width - PDF_MARGIN * 2
  const h = doc.heightOfString(title, { width })
  doc.text(title, PDF_MARGIN, y, { width })
  return y + h + 10
}

function drawTableHeaderRow(
  doc: PnlPdfDoc,
  y: number,
  layout: ReturnType<typeof pnlTableLayout>
): number {
  resetPdfTextState(doc)
  doc.fontSize(10).font("Helvetica-Bold")
  const headers = ["Account Code", "Account Name", "Period Total"]
  const rowH = MIN_ROW_H + 4
  let x = layout.left
  headers.forEach((header, i) => {
    const w = layout.columnWidths[i]
    doc.rect(x, y, w, rowH).stroke()
    doc.text(header, x + CELL_PAD_X, y + CELL_PAD_Y, {
      width: w - CELL_PAD_X * 2,
      align: i === 2 ? "right" : "left",
    })
    x += w
  })
  return y + rowH
}

function drawEmptyTableRow(
  doc: PnlPdfDoc,
  y: number,
  layout: ReturnType<typeof pnlTableLayout>,
  message: string
): number {
  resetPdfTextState(doc)
  doc.fontSize(9).font("Helvetica")
  const rowH = rowHeightForText(doc, message, layout.tableWidth)
  doc.rect(layout.left, y, layout.tableWidth, rowH).stroke()
  doc.text(message, layout.left + CELL_PAD_X, y + CELL_PAD_Y, {
    width: layout.tableWidth - CELL_PAD_X * 2,
    align: "left",
  })
  return y + rowH
}

type PnlExportLine = {
  account_code?: string
  account_name?: string
  period_total?: number
}

function drawAccountRow(
  doc: PnlPdfDoc,
  y: number,
  layout: ReturnType<typeof pnlTableLayout>,
  account: PnlExportLine
): number {
  resetPdfTextState(doc)
  doc.fontSize(9).font("Helvetica")
  const code = account.account_code || ""
  const name = account.account_name || ""
  const total = formatNumeric(account.period_total || 0)
  const rowH = Math.max(
    rowHeightForText(doc, code, layout.columnWidths[0]),
    rowHeightForText(doc, name, layout.columnWidths[1]),
    MIN_ROW_H
  )
  let x = layout.left

  doc.rect(x, y, layout.columnWidths[0], rowH).stroke()
  doc.text(code, x + CELL_PAD_X, y + CELL_PAD_Y, {
    width: layout.columnWidths[0] - CELL_PAD_X * 2,
  })
  x += layout.columnWidths[0]

  doc.rect(x, y, layout.columnWidths[1], rowH).stroke()
  doc.text(name, x + CELL_PAD_X, y + CELL_PAD_Y, {
    width: layout.columnWidths[1] - CELL_PAD_X * 2,
  })
  x += layout.columnWidths[1]

  doc.rect(x, y, layout.columnWidths[2], rowH).stroke()
  doc.text(total, x + CELL_PAD_X, y + CELL_PAD_Y, {
    width: layout.columnWidths[2] - CELL_PAD_X * 2,
    align: "right",
  })

  return y + rowH
}

function drawSubtotalRow(
  doc: PnlPdfDoc,
  y: number,
  layout: ReturnType<typeof pnlTableLayout>,
  label: string,
  amount: number,
  fill: string
): number {
  const rowH = MIN_ROW_H + 4
  const labelWidth = layout.columnWidths[0] + layout.columnWidths[1]

  doc.rect(layout.left, y, labelWidth, rowH).fillAndStroke(fill, "#000000")
  resetPdfTextState(doc)
  doc.fontSize(10).font("Helvetica-Bold")
  doc.text(label, layout.left + CELL_PAD_X, y + CELL_PAD_Y, {
    width: labelWidth - CELL_PAD_X * 2,
  })

  doc.rect(layout.left + labelWidth, y, layout.columnWidths[2], rowH).fillAndStroke(fill, "#000000")
  resetPdfTextState(doc)
  doc.fontSize(10).font("Helvetica-Bold")
  doc.text(formatNumeric(amount), layout.left + labelWidth + CELL_PAD_X, y + CELL_PAD_Y, {
    width: layout.columnWidths[2] - CELL_PAD_X * 2,
    align: "right",
  })

  return y + rowH
}

function drawAccountSection(
  doc: PnlPdfDoc,
  y: number,
  layout: ReturnType<typeof pnlTableLayout>,
  heading: string,
  accounts: PnlExportLine[],
  emptyMessage: string,
  totalLabel: string,
  totalAmount: number,
  addFooter: () => void
): number {
  y = ensurePageSpace(doc, y, MIN_ROW_H * 4, addFooter)
  y = drawSectionHeading(doc, y, heading)
  y = drawTableHeaderRow(doc, y, layout)

  if (accounts.length === 0) {
    const emptyH = rowHeightForText(doc, emptyMessage, layout.tableWidth)
    y = ensurePageSpace(doc, y, emptyH, addFooter)
    y = drawEmptyTableRow(doc, y, layout, emptyMessage)
  } else {
    for (const account of accounts) {
      const name = account.account_name || ""
      const rowH = Math.max(
        rowHeightForText(doc, name, layout.columnWidths[1]),
        MIN_ROW_H
      )
      y = ensurePageSpace(doc, y, rowH, addFooter)
      y = drawAccountRow(doc, y, layout, account)
    }
  }

  y = ensurePageSpace(doc, y, MIN_ROW_H + 4, addFooter)
  y = drawSubtotalRow(doc, y, layout, totalLabel, totalAmount, "#F0F0F0")
  return y + 12
}
