import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accounting/auth"
import { resolveAccountingPeriodForReport } from "@/lib/accounting/resolveAccountingPeriodForReport"
import { assertAccountingAccess, accountingUserFromRequest } from "@/lib/accounting/permissions"
import { resolveAccountingContext } from "@/lib/accounting/resolveAccountingContext"
import { getBalanceSheetReport } from "@/lib/accounting/reports/getBalanceSheetReport"
import { toBalanceSheetExportView } from "@/lib/accounting/reports/balanceSheetExportHelpers"
import { getProfitAndLossReport } from "@/lib/accounting/reports/getProfitAndLossReport"
import { toPnLExportView } from "@/lib/accounting/reports/pnlExportHelpers"

/**
 * GET /api/accounting/afs/runs/[id]/export/pdf
 *
 * Exports an AFS run as a single PDF bundle containing:
 *   1. Cover page — business name, period, finalization status, input_hash
 *   2. Statement of Profit or Loss (Income Statement)
 *   3. Statement of Financial Position (Balance Sheet) with entity-appropriate equity section
 *   4. Trial Balance
 *
 * Query Parameters:
 *   - business_id (required)
 *
 * Access: Admin / Owner / Accountant (read or above)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await Promise.resolve(params)
    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get("business_id")

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
      return NextResponse.json({ error: "Missing required parameter: business_id" }, { status: 400 })
    }
    const resolvedBusinessId = resolved.businessId

    const authResult = await checkAccountingAuthority(supabase, user.id, resolvedBusinessId, "read")
    if (!authResult.authorized) {
      return NextResponse.json(
        { error: "Unauthorized. Only admins, owners, or accountants can export AFS." },
        { status: 403 }
      )
    }

    // ── Fetch AFS run ────────────────────────────────────────────────────────
    const { data: run, error: runError } = await supabase
      .from("afs_runs")
      .select("*")
      .eq("id", id)
      .eq("business_id", resolvedBusinessId)
      .single()

    if (runError || !run) {
      return NextResponse.json({ error: "AFS run not found" }, { status: 404 })
    }

    // ── Resolve accounting period ─────────────────────────────────────────────
    const { period: resolvedPeriod, error: resolveError } = await resolveAccountingPeriodForReport(
      supabase,
      {
        businessId: resolvedBusinessId,
        period_start: run.period_start ?? null,
        end_date: run.period_end ?? null,
      }
    )
    if (resolveError || !resolvedPeriod) {
      return NextResponse.json(
        { error: resolveError ?? "Could not resolve accounting period for this AFS run." },
        { status: 500 }
      )
    }

    const periodId = resolvedPeriod.period_id

    // ── Fetch business info ───────────────────────────────────────────────────
    const { data: business } = await supabase
      .from("businesses")
      .select("name, legal_name, default_currency, business_type")
      .eq("id", resolvedBusinessId)
      .single()

    const businessName = (business as any)?.legal_name || (business as any)?.name || "Business"
    const businessType: string = (business as any)?.business_type ?? "limited_company"
    // ── Fetch report data ─────────────────────────────────────────────────────

    // P&L (canonical ledger movement)
    const { data: pnlReportData, error: pnlReportError } = await getProfitAndLossReport(supabase, {
      businessId: resolvedBusinessId,
      period_start: run.period_start ?? null,
      end_date: run.period_end ?? null,
    })
    if (pnlReportError || !pnlReportData) {
      return NextResponse.json(
        { error: pnlReportError || "Failed to fetch P&L for AFS export" },
        { status: 500 }
      )
    }
    const pnlView = toPnLExportView(pnlReportData)
    const incomeRows = pnlView.incomeLines
    const expenseRows = pnlView.expenseLines
    const totalIncome = pnlView.totalRevenue
    const totalExpenses = pnlView.totalExpenses
    const netProfit = pnlView.netProfit
    const pnlPeriodStart = pnlView.periodStart
    const pnlPeriodEnd = pnlView.periodEnd

    // Balance Sheet (canonical ledger as-of + cumulative net income)
    const { data: bsReportData, error: bsReportError } = await getBalanceSheetReport(supabase, {
      businessId: resolvedBusinessId,
      period_start: run.period_start ?? null,
      end_date: run.period_end ?? null,
      business_type: businessType as "limited_company" | "sole_proprietorship",
    })
    if (bsReportError || !bsReportData) {
      return NextResponse.json(
        { error: bsReportError || "Failed to fetch balance sheet for AFS export" },
        { status: 500 }
      )
    }
    const bsView = toBalanceSheetExportView(bsReportData)
    const {
      assetLines: assetRows,
      liabilityLines: liabilityRows,
      equityLines: equityRows,
      totals: bsTotals,
      adjustedEquity,
      equitySectionLabel: equitySectionTitle,
      asOfDate: bsAsOfDate,
    } = bsView
    const totalAssets = bsTotals.assets
    const totalLiabilities = bsTotals.liabilities

    // Trial Balance
    const { data: tbRows } = await supabase.rpc("get_trial_balance_snapshot", {
      p_period_id: periodId,
    })
    type TbRow = { account_code?: string; account_name?: string; account_type?: string; debit_total?: number | null; credit_total?: number | null; balance?: number | null }
    const tbData = (tbRows ?? []) as TbRow[]

    // ── Build PDF ─────────────────────────────────────────────────────────────
    const PDFDocument = (await import("pdfkit")).default
    const doc = new PDFDocument({ margin: 50, size: "A4" })
    const chunks: Buffer[] = []
    doc.on("data", (chunk: Buffer) => chunks.push(chunk))

    const pageW     = doc.page.width   // 595 pt for A4
    const margin    = 50
    const contentW  = pageW - margin * 2
    const rowH      = 22
    const generated = new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC"
    const currencyCode: string = (business as any)?.default_currency ?? ""

    // ── Shared helpers ────────────────────────────────────────────────────────
    const fmt = (n: number | null | undefined) =>
      n == null || isNaN(Number(n)) ? "0.00" : Number(n).toFixed(2)

    const ensureSpace = (needed: number) => {
      if (doc.y + needed > doc.page.height - 60) doc.addPage()
    }

    const drawPageFooter = () => {
      const y = doc.page.height - 35
      doc.fontSize(7).font("Helvetica").fillColor("#888888")
        .text(`Generated ${generated}`, margin, y, { width: contentW / 2, align: "left" })
        .text("Finza — Confidential", margin + contentW / 2, y, { width: contentW / 2, align: "right" })
      doc.fillColor("#000000")
    }

    // Re-draw footer on every new page
    doc.on("pageAdded", () => {
      drawPageFooter()
    })

    const sectionHeading = (title: string) => {
      ensureSpace(rowH + 14)
      doc.moveDown(0.6)
      doc.fontSize(12).font("Helvetica-Bold").fillColor("#1e3a5f").text(title.toUpperCase(), margin)
      doc.moveDown(0.3)
      doc.fillColor("#000000")
    }

    // Cols: [code, name, amount] — code is narrow, name wide, amount right-aligned
    const cols = {
      code:   { x: margin,           w: 60 },
      name:   { x: margin + 60,      w: contentW - 60 - 110 },
      amount: { x: margin + contentW - 110, w: 110 },
    }

    const tableHeader = (labels: [string, string, string]) => {
      ensureSpace(rowH)
      const y = doc.y
      doc.fontSize(8).font("Helvetica-Bold")
      doc.rect(margin, y, contentW, rowH).fillAndStroke("#1e3a5f", "#1e3a5f")
      doc.fillColor("#ffffff")
      doc.text(labels[0], cols.code.x + 4,   y + 6, { width: cols.code.w - 8 })
      doc.text(labels[1], cols.name.x + 4,   y + 6, { width: cols.name.w - 8 })
      doc.text(labels[2], cols.amount.x + 4, y + 6, { width: cols.amount.w - 8, align: "right" })
      doc.fillColor("#000000")
      doc.y = y + rowH
    }

    const tableRow = (code: string, name: string, amount: string, shade = false) => {
      ensureSpace(rowH)
      const y = doc.y
      if (shade) {
        doc.rect(margin, y, contentW, rowH).fillAndStroke("#f4f6f9", "#e0e0e0")
      } else {
        doc.rect(margin, y, contentW, rowH).stroke()
      }
      doc.fontSize(8).font("Helvetica").fillColor("#000000")
      doc.text(code,   cols.code.x + 4,   y + 6, { width: cols.code.w - 8 })
      doc.text(name,   cols.name.x + 4,   y + 6, { width: cols.name.w - 8 })
      doc.text(amount, cols.amount.x + 4, y + 6, { width: cols.amount.w - 8, align: "right" })
      doc.y = y + rowH
    }

    const totalRow = (label: string, amount: string) => {
      ensureSpace(rowH)
      const y = doc.y
      doc.rect(margin, y, contentW - cols.amount.w, rowH).fillAndStroke("#d0d8e4", "#1e3a5f")
      doc.rect(margin + contentW - cols.amount.w, y, cols.amount.w, rowH).fillAndStroke("#d0d8e4", "#1e3a5f")
      doc.fontSize(9).font("Helvetica-Bold").fillColor("#1e3a5f")
      doc.text(label,  margin + 4, y + 5, { width: contentW - cols.amount.w - 8 })
      doc.text(amount, margin + contentW - cols.amount.w + 4, y + 5, { width: cols.amount.w - 8, align: "right" })
      doc.fillColor("#000000")
      doc.y = y + rowH
    }

    // ── 1. COVER PAGE ─────────────────────────────────────────────────────────
    const coverY = doc.page.height / 2 - 80

    // Banner bar
    doc.rect(margin, coverY - 10, contentW, 6).fill("#1e3a5f")

    doc.fontSize(22).font("Helvetica-Bold").fillColor("#1e3a5f")
      .text("Annual Financial Statements", margin, coverY + 10, { align: "center", width: contentW })

    doc.moveDown(0.5)
    doc.fontSize(14).font("Helvetica").fillColor("#333333")
      .text(businessName, { align: "center", width: contentW })

    doc.moveDown(0.4)
    doc.fontSize(11).fillColor("#555555")
      .text(`Period: ${resolvedPeriod.period_start} – ${resolvedPeriod.period_end}`, { align: "center", width: contentW })

    doc.moveDown(0.3)
    const statusText = run.status === "finalized"
      ? `Finalized on ${run.finalized_at ? new Date(run.finalized_at).toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" }) : "—"}`
      : "Draft — not yet finalized"
    doc.fontSize(10).fillColor(run.status === "finalized" ? "#1a6e3a" : "#c0392b")
      .text(statusText, { align: "center", width: contentW })

    doc.moveDown(0.4)
    doc.fontSize(8).fillColor("#888888")
      .text(`AFS Run ID: ${id}`, { align: "center", width: contentW })
    doc.text(`Input hash: ${run.input_hash ?? "—"}`, { align: "center", width: contentW })

    doc.rect(margin, doc.y + 8, contentW, 2).fill("#1e3a5f")
    doc.fillColor("#000000")

    drawPageFooter()

    // ── 2. PROFIT & LOSS ──────────────────────────────────────────────────────
    doc.addPage()
    doc.fontSize(14).font("Helvetica-Bold").fillColor("#1e3a5f")
      .text("Statement of Profit or Loss", margin, margin)
    doc.fontSize(9).font("Helvetica").fillColor("#555555")
      .text(`${businessName}   |   ${pnlPeriodStart} to ${pnlPeriodEnd}${currencyCode ? "   |   " + currencyCode : ""}`, margin)
    doc.fillColor("#000000").moveDown(0.4)

    sectionHeading("Revenue / Income")
    tableHeader(["Code", "Account", "Amount"])
    incomeRows.forEach((r, i) => {
      tableRow(r.account_code ?? "", r.account_name ?? "", fmt(r.period_total), i % 2 === 1)
    })
    totalRow("Total Revenue", fmt(totalIncome))

    doc.moveDown(0.6)
    sectionHeading("Expenses")
    tableHeader(["Code", "Account", "Amount"])
    expenseRows.forEach((r, i) => {
      tableRow(r.account_code ?? "", r.account_name ?? "", fmt(r.period_total), i % 2 === 1)
    })
    totalRow("Total Expenses", fmt(totalExpenses))

    doc.moveDown(0.6)
    ensureSpace(rowH + 4)
    const plSummaryY = doc.y
    doc.rect(margin, plSummaryY, contentW, rowH + 4)
      .fillAndStroke(netProfit >= 0 ? "#e8f5e9" : "#fce4ec", "#1e3a5f")
    doc.fontSize(11).font("Helvetica-Bold")
      .fillColor(netProfit >= 0 ? "#1a6e3a" : "#c0392b")
      .text(
        `${netProfit >= 0 ? "Net Profit" : "Net Loss"} for Period: ${fmt(netProfit)}`,
        margin + 8, plSummaryY + 8,
        { width: contentW - 16 }
      )
    doc.fillColor("#000000")

    // ── 3. BALANCE SHEET ──────────────────────────────────────────────────────
    doc.addPage()
    doc.fontSize(14).font("Helvetica-Bold").fillColor("#1e3a5f")
      .text("Statement of Financial Position", margin, margin)
    doc.fontSize(9).font("Helvetica").fillColor("#555555")
      .text(`${businessName}   |   As at ${bsAsOfDate}${currencyCode ? "   |   " + currencyCode : ""}`, margin)
    doc.fillColor("#000000").moveDown(0.4)

    sectionHeading("Assets")
    tableHeader(["Code", "Account", "Balance"])
    assetRows.forEach((r, i) => {
      tableRow(r.account_code ?? "", r.account_name ?? "", fmt(r.amount), i % 2 === 1)
    })
    totalRow("Total Assets", fmt(totalAssets))

    doc.moveDown(0.6)
    sectionHeading("Liabilities")
    tableHeader(["Code", "Account", "Balance"])
    liabilityRows.forEach((r, i) => {
      tableRow(r.account_code ?? "", r.account_name ?? "", fmt(r.amount), i % 2 === 1)
    })
    totalRow("Total Liabilities", fmt(totalLiabilities))

    doc.moveDown(0.6)
    sectionHeading(equitySectionTitle)
    tableHeader(["Code", "Account", "Balance"])
    equityRows.forEach((r, i) => {
      tableRow(r.account_code ?? "", r.account_name ?? "", fmt(r.amount), i % 2 === 1)
    })
    totalRow(`Total ${equitySectionTitle}`, fmt(adjustedEquity))

    doc.moveDown(0.4)
    ensureSpace(rowH)
    totalRow("Total Liabilities + " + equitySectionTitle, fmt(bsTotals.liabilities_plus_equity))

    // Balanced indicator
    const isBalanced = bsTotals.is_balanced
    doc.moveDown(0.3)
    doc.fontSize(8).font("Helvetica").fillColor(isBalanced ? "#1a6e3a" : "#c0392b")
      .text(isBalanced ? "✓ Statement is balanced" : `⚠ Imbalance: ${fmt(bsTotals.imbalance)}`, margin)
    doc.fillColor("#000000")

    // ── 4. TRIAL BALANCE ──────────────────────────────────────────────────────
    doc.addPage()
    doc.fontSize(14).font("Helvetica-Bold").fillColor("#1e3a5f")
      .text("Trial Balance", margin, margin)
    doc.fontSize(9).font("Helvetica").fillColor("#555555")
      .text(`${businessName}   |   ${resolvedPeriod.period_start} to ${resolvedPeriod.period_end}${currencyCode ? "   |   " + currencyCode : ""}`, margin)
    doc.fillColor("#000000").moveDown(0.4)

    // Trial balance uses 4 columns: code, name, debit, credit
    const tbCols = {
      code:   { x: margin,                  w: 55 },
      name:   { x: margin + 55,             w: contentW - 55 - 110 - 110 },
      debit:  { x: margin + contentW - 220, w: 110 },
      credit: { x: margin + contentW - 110, w: 110 },
    }

    const tbHeader = () => {
      ensureSpace(rowH)
      const y = doc.y
      doc.rect(margin, y, contentW, rowH).fillAndStroke("#1e3a5f", "#1e3a5f")
      doc.fontSize(8).font("Helvetica-Bold").fillColor("#ffffff")
      doc.text("Code",    tbCols.code.x + 4,   y + 6, { width: tbCols.code.w - 8 })
      doc.text("Account", tbCols.name.x + 4,   y + 6, { width: tbCols.name.w - 8 })
      doc.text("Debit",   tbCols.debit.x + 4,  y + 6, { width: tbCols.debit.w - 8,  align: "right" })
      doc.text("Credit",  tbCols.credit.x + 4, y + 6, { width: tbCols.credit.w - 8, align: "right" })
      doc.fillColor("#000000")
      doc.y = y + rowH
    }

    const tbRow = (r: TbRow, shade: boolean) => {
      ensureSpace(rowH)
      const y = doc.y
      if (shade) {
        doc.rect(margin, y, contentW, rowH).fillAndStroke("#f4f6f9", "#e0e0e0")
      } else {
        doc.rect(margin, y, contentW, rowH).stroke()
      }
      doc.fontSize(8).font("Helvetica").fillColor("#000000")
      doc.text(r.account_code ?? "", tbCols.code.x + 4,   y + 6, { width: tbCols.code.w - 8 })
      doc.text(r.account_name ?? "", tbCols.name.x + 4,   y + 6, { width: tbCols.name.w - 8 })
      doc.text(fmt(r.debit_total),   tbCols.debit.x + 4,  y + 6, { width: tbCols.debit.w - 8,  align: "right" })
      doc.text(fmt(r.credit_total),  tbCols.credit.x + 4, y + 6, { width: tbCols.credit.w - 8, align: "right" })
      doc.y = y + rowH
    }

    tbHeader()
    if (tbData.length === 0) {
      doc.fontSize(9).font("Helvetica").text("No trial balance data for this period.", margin)
    } else {
      tbData.forEach((r, i) => tbRow(r, i % 2 === 1))

      // Totals row
      const totalDebit  = tbData.reduce((s, r) => s + Number(r.debit_total  ?? 0), 0)
      const totalCredit = tbData.reduce((s, r) => s + Number(r.credit_total ?? 0), 0)
      ensureSpace(rowH)
      const ty = doc.y
      doc.rect(margin, ty, contentW, rowH).fillAndStroke("#d0d8e4", "#1e3a5f")
      doc.fontSize(9).font("Helvetica-Bold").fillColor("#1e3a5f")
      doc.text("TOTALS", tbCols.code.x + 4, ty + 5, { width: tbCols.code.w + tbCols.name.w - 8 })
      doc.text(fmt(totalDebit),  tbCols.debit.x + 4,  ty + 5, { width: tbCols.debit.w - 8,  align: "right" })
      doc.text(fmt(totalCredit), tbCols.credit.x + 4, ty + 5, { width: tbCols.credit.w - 8, align: "right" })
      doc.fillColor("#000000")
      doc.y = ty + rowH

      const tbBalanced = Math.abs(totalDebit - totalCredit) < 0.02
      doc.moveDown(0.3)
      doc.fontSize(8).fillColor(tbBalanced ? "#1a6e3a" : "#c0392b")
        .text(tbBalanced ? "✓ Trial balance is in balance" : `⚠ Out of balance by ${fmt(totalDebit - totalCredit)}`, margin)
      doc.fillColor("#000000")
    }

    // ── Finalise & stream ─────────────────────────────────────────────────────
    drawPageFooter()
    doc.end()

    await new Promise<void>((resolve) => doc.on("end", resolve))
    const pdfBuffer = Buffer.concat(chunks)

    const safeBusinessName = businessName.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase()
    const filename = `afs-${safeBusinessName}-${resolvedPeriod.period_start}-${resolvedPeriod.period_end}.pdf`

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    })
  } catch (error: any) {
    console.error("Error generating AFS PDF:", error)
    if (error.message?.includes("Cannot find module")) {
      return NextResponse.json(
        { error: "PDF generation requires 'pdfkit'. Run: npm install pdfkit @types/pdfkit" },
        { status: 500 }
      )
    }
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}
