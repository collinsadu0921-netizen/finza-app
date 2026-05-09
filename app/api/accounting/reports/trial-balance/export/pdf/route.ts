import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { ensureAccountingInitialized, canUserInitializeAccounting } from "@/lib/accounting/bootstrap"
import { checkAccountingReadiness } from "@/lib/accounting/readiness"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { enforceServiceIndustryBusinessTierForAccountingApi } from "@/lib/serviceWorkspace/enforceServiceIndustryBusinessTierForAccountingApi"
import { getTrialBalanceReport } from "@/lib/accounting/reports/getTrialBalanceReport"

/**
 * GET /api/accounting/reports/trial-balance/export/pdf
 * Exports Trial Balance as PDF. Period resolved server-side via universal resolver.
 * Query: business_id (required), period_id | period_start | as_of_date | start_date/end_date (optional).
 *
 * Uses the same shared loader as the JSON endpoint, so period, accounts,
 * totals, and balance status always match. Fails loudly (HTTP 500) when
 * the trial balance is unbalanced — never silently exports a broken ledger.
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
        { error: "Unauthorized. Only admins, owners, or accountants can export trial balance." },
        { status: 403 }
      )
    }

    const tierBlockTbPdf = await enforceServiceIndustryBusinessTierForAccountingApi(
      supabase,
      user.id,
      resolvedBusinessId
    )
    if (tierBlockTbPdf) return tierBlockTbPdf

    if (!canUserInitializeAccounting(auth.authority_source)) {
      const { ready } = await checkAccountingReadiness(supabase, resolvedBusinessId)
      if (!ready) {
        return NextResponse.json(
          { error: "ACCOUNTING_NOT_READY", business_id: resolvedBusinessId, authority_source: auth.authority_source },
          { status: 403 }
        )
      }
    } else {
      const { error: bootstrapErr } = await ensureAccountingInitialized(supabase, resolvedBusinessId)
      if (bootstrapErr) {
        return NextResponse.json(
          { error: "ACCOUNTING_NOT_READY", business_id: resolvedBusinessId, authority_source: auth.authority_source },
          { status: 500 }
        )
      }
      await supabase.rpc("create_system_accounts", { p_business_id: resolvedBusinessId })
    }

    const { data: business } = await supabase
      .from("businesses")
      .select("name")
      .eq("id", resolvedBusinessId)
      .single()

    const result = await getTrialBalanceReport(supabase, {
      businessId: resolvedBusinessId,
      period_id: periodId,
      period_start: periodStart,
      as_of_date: asOfDate,
      start_date: startDate,
      end_date: endDate,
    })

    if (result.error || !result.data) {
      return NextResponse.json(
        { error: result.error ?? "Failed to fetch trial balance" },
        { status: result.status ?? 500 }
      )
    }

    const { data } = result

    // INVARIANT 3: Fail loudly if unbalanced - never hide ledger errors in exports.
    if (!data.isBalanced) {
      return NextResponse.json(
        {
          error: "Trial Balance is unbalanced",
          imbalance: data.imbalance,
          totalDebits: data.totals.totalDebits,
          totalCredits: data.totals.totalCredits,
          message:
            "Ledger integrity error: Debits and credits do not match. PDF export blocked until the imbalance is resolved.",
        },
        { status: 500 }
      )
    }

    const effectiveStartDate = data.period.period_start
    const effectiveEndDate = data.period.period_end

    const start = new Date(effectiveStartDate)
    const end = new Date(effectiveEndDate)
    const yearsDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365)
    if (yearsDiff > 10) {
      return NextResponse.json(
        { error: "Date range cannot exceed 10 years. Please select a smaller range." },
        { status: 400 }
      )
    }

    const rowCount = data.accounts.length
    if (rowCount > 5000) {
      return NextResponse.json(
        {
          error: `Trial balance has ${rowCount} rows, which exceeds the maximum PDF export limit of 5,000 rows. Please use CSV export instead or use a smaller date range.`,
        },
        { status: 400 }
      )
    }

    // Use the standard server PDFKit build. The standalone bundle is for
    // browsers and overflows the call stack when run on the Node.js server.
    // PDFKit's built-in AFM font metrics (e.g. Helvetica.afm) are bundled
    // into the server runtime via outputFileTracingIncludes in next.config.js.
    const PDFDocument = (await import("pdfkit")).default
    // autoFirstPage:false so the pageAdded handler can paint chrome on EVERY
    // page, including the very first one. Landscape A4 fits 7 columns cleanly.
    const doc = new PDFDocument({ margin: 50, size: "A4", layout: "landscape", autoFirstPage: false })

    const chunks: Buffer[] = []
    doc.on("data", (chunk: Buffer) => {
      chunks.push(chunk)
    })

    // ---- Layout constants ----
    const PAGE_LEFT = 50
    const PAGE_TOP = 50
    const FOOTER_HEIGHT = 30
    const TITLE_BLOCK_HEIGHT = 60
    const HEADER_ROW_HEIGHT = 22
    const DATA_ROW_HEIGHT = 18
    const TOTALS_ROW_HEIGHT = 22

    // 7 columns matching CSV: Code, Name, Type, Opening, Debit, Credit, Closing.
    const columns: Array<{ label: string; width: number; align: "left" | "right" }> = [
      { label: "Account Code", width: 80, align: "left" },
      { label: "Account Name", width: 200, align: "left" },
      { label: "Type", width: 70, align: "left" },
      { label: "Opening Balance", width: 95, align: "right" },
      { label: "Debit Total", width: 95, align: "right" },
      { label: "Credit Total", width: 95, align: "right" },
      { label: "Closing Balance", width: 95, align: "right" },
    ]
    const totalTableWidth = columns.reduce((s, c) => s + c.width, 0)

    const businessName = business?.name || "Business"
    const periodLabel = `Period: ${data.period.period_start} to ${data.period.period_end}`
    const generatedAt = new Date().toISOString()

    let isFirstPage = true

    const drawColumnHeader = (yTop: number) => {
      doc.fontSize(10).font("Helvetica-Bold").fillColor("#000000")
      let x = PAGE_LEFT
      for (const col of columns) {
        doc.rect(x, yTop, col.width, HEADER_ROW_HEIGHT).fillAndStroke("#F0F0F0", "#000000")
        // lineBreak:false prevents PDFKit from auto-flowing text to a new page,
        // which would otherwise re-fire pageAdded and recurse.
        doc.fillColor("#000000").text(col.label, x + 5, yTop + 6, {
          width: col.width - 10,
          align: col.align,
          lineBreak: false,
        })
        x += col.width
      }
    }

    const drawFooter = () => {
      const pageHeight = doc.page.height
      const pageWidth = doc.page.width
      const footerY = pageHeight - FOOTER_HEIGHT

      // PDFKit's LineWrapper triggers an automatic addPage() whenever
      // doc.y > page.maxY(). Footers live in the bottom margin band BY DESIGN
      // (y > maxY), so any doc.text() call there would recurse into addPage.
      // Zero the bottom margin around the footer draw so maxY === pageHeight,
      // which keeps the wrapper from firing nextSection().
      const savedBottomMargin = doc.page.margins.bottom
      doc.page.margins.bottom = 0
      try {
        doc.fontSize(8).font("Helvetica").fillColor("#000000")
        doc.text(`Generated on ${generatedAt}`, PAGE_LEFT, footerY, {
          width: pageWidth - PAGE_LEFT * 2,
          align: "left",
          lineBreak: false,
        })
        doc.text(
          `${businessName} — FINZA — Read-only report`,
          PAGE_LEFT,
          footerY,
          {
            width: pageWidth - PAGE_LEFT * 2,
            align: "right",
            lineBreak: false,
          }
        )
      } finally {
        doc.page.margins.bottom = savedBottomMargin
      }
    }

    // Returns the y at which row content can begin on the new page.
    const drawPageChrome = (firstPage: boolean): number => {
      let y = PAGE_TOP
      if (firstPage) {
        const innerWidth = doc.page.width - PAGE_LEFT * 2
        doc.fontSize(18).font("Helvetica-Bold").fillColor("#000000")
        doc.text("Trial Balance Report", PAGE_LEFT, y, {
          width: innerWidth,
          align: "center",
          lineBreak: false,
        })
        doc.fontSize(12).font("Helvetica").fillColor("#000000")
        doc.text(`${businessName} — ${periodLabel}`, PAGE_LEFT, y + 26, {
          width: innerWidth,
          align: "center",
          lineBreak: false,
        })
        y += TITLE_BLOCK_HEIGHT
      }
      drawColumnHeader(y)
      drawFooter()
      return y + HEADER_ROW_HEIGHT
    }

    // pageAdded fires for every doc.addPage() — including the very first
    // because autoFirstPage:false. Use the isFirstPage latch to render the
    // title block once. The drawingChrome guard prevents PDFKit from
    // recursively re-entering this listener if a chrome draw call ever
    // triggered an auto-page-break (which would overflow the call stack).
    let drawingChrome = false
    let nextRowY = 0
    doc.on("pageAdded", () => {
      if (drawingChrome) return
      drawingChrome = true
      try {
        const firstPage = isFirstPage
        isFirstPage = false
        nextRowY = drawPageChrome(firstPage)
      } finally {
        drawingChrome = false
      }
    })

    doc.addPage()
    let y = nextRowY

    const pageBottomLimit = () => doc.page.height - PAGE_TOP - FOOTER_HEIGHT

    const ensureSpace = (need: number) => {
      if (y + need > pageBottomLimit()) {
        doc.addPage()
        y = nextRowY
      }
    }

    const drawRow = (cells: string[], rowHeight: number, isHeaderLike: boolean, fillColor?: string) => {
      doc.fontSize(isHeaderLike ? 10 : 9).font(isHeaderLike ? "Helvetica-Bold" : "Helvetica")
      let x = PAGE_LEFT
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i]
        if (fillColor) {
          doc.rect(x, y, col.width, rowHeight).fillAndStroke(fillColor, "#000000")
          doc.fillColor("#000000")
        } else {
          doc.rect(x, y, col.width, rowHeight).stroke()
        }
        doc.text(cells[i] ?? "", x + 5, y + (rowHeight - 12) / 2, {
          width: col.width - 10,
          align: col.align,
          ellipsis: true,
          lineBreak: false,
        })
        x += col.width
      }
    }

    // ---- Data rows ----
    for (const account of data.accounts) {
      ensureSpace(DATA_ROW_HEIGHT)
      drawRow(
        [
          account.account_code,
          account.account_name,
          account.account_type,
          formatNumeric(account.opening_balance),
          formatNumeric(account.debit_total),
          formatNumeric(account.credit_total),
          formatNumeric(account.closing_balance),
        ],
        DATA_ROW_HEIGHT,
        false
      )
      y += DATA_ROW_HEIGHT
    }

    // ---- Totals row ----
    // Don't put (debit - credit) under "Closing Balance" — that label is misleading.
    // Show TB column totals only where they're meaningful (Debit/Credit), and
    // put the balance check on its own line just below.
    const totalDebits = data.totals.totalDebits
    const totalCredits = data.totals.totalCredits
    const isBalanced = data.isBalanced
    const difference = Math.round((totalDebits - totalCredits) * 100) / 100

    ensureSpace(TOTALS_ROW_HEIGHT + 22)

    drawRow(
      [
        "Totals",
        "",
        "",
        "—",
        formatNumeric(totalDebits),
        formatNumeric(totalCredits),
        "—",
      ],
      TOTALS_ROW_HEIGHT,
      true,
      "#F0F0F0"
    )
    y += TOTALS_ROW_HEIGHT

    // ---- Balance check (separate from totals row) ----
    doc.fontSize(10).font("Helvetica-Bold").fillColor(isBalanced ? "#0B7A3B" : "#B91C1C")
    doc.text(
      `Difference: ${formatNumeric(Math.abs(difference))}    Balanced: ${isBalanced ? "Yes" : "No"}`,
      PAGE_LEFT,
      y + 6,
      { width: totalTableWidth, align: "right", lineBreak: false }
    )
    doc.fillColor("#000000")
    y += 22

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
    const filename = `trial-balance-${periodLabelForFile}.pdf`

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
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
 * Format numeric value for PDF (no currency symbols, 2 decimal places).
 */
function formatNumeric(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(Number(value))) {
    return "0.00"
  }
  return Number(value).toFixed(2)
}
