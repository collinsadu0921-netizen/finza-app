import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { checkAccountingAuthority } from "@/lib/accountingAuth"
import { resolveAccountingPeriodForReport } from "@/lib/accounting/resolveAccountingPeriodForReport"

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

    if (!businessId) {
      return NextResponse.json({ error: "Missing required parameter: business_id" }, { status: 400 })
    }

    const authResult = await checkAccountingAuthority(supabase, user.id, businessId, "read")
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
      .eq("business_id", businessId)
      .single()

    if (runError || !run) {
      return NextResponse.json({ error: "AFS run not found" }, { status: 404 })
    }

    // ── Resolve accounting period ─────────────────────────────────────────────
    const { period: resolvedPeriod, error: resolveError } = await resolveAccountingPeriodForReport(
      supabase,
      {
        businessId,
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
      .eq("id", businessId)
      .single()

    const businessName = (business as any)?.legal_name || (business as any)?.name || "Business"
    const businessType: string = (business as any)?.business_type ?? "limited_company"
    const isSoleProp = businessType === "sole_proprietorship"
    const equitySectionTitle = isSoleProp ? "Owner's Equity" : "Equity"
    const netIncomeLabel = isSoleProp ? "Net Profit for Period" : "Current Period Net Income"

    // ── Fetch report data via snapshot RPCs ───────────────────────────────────

    // P&L
    const { data: pnlRows } = await supabase.rpc("get_profit_and_loss_from_trial_balance", {
      p_period_id: periodId,
    })
    type PnlRow = { account_code?: string; account_name?: string; account_type?: string; period_total?: number | null }
    const pnlData = (pnlRows ?? []) as PnlRow[]

    const incomeRows = pnlData.filter((r) => r.account_type === "income" || r.account_type === "revenue")
    const expenseRows = pnlData.filter((r) => r.account_type === "expense")
    const totalIncome = incomeRows.reduce((s, r) => s + Number(r.period_total ?? 0), 0)
    const totalExpenses = expenseRows.reduce((s, r) => s + Number(r.period_total ?? 0), 0)
    const netProfit = Math.round((totalIncome - totalExpenses) * 100) / 100

    // Balance Sheet
    const { data: bsRows } = await supabase.rpc("get_balance_sheet_from_trial_balance", {
      p_period_id: periodId,
    })
    type BsRow = { account_code?: string; account_name?: string; account_type?: string; balance?: number | null }
    const bsData = (bsRows ?? []) as BsRow[]

    const assetRows      = bsData.filter((r) => r.account_type === "asset" || r.account_type === "contra_asset")
    const liabilityRows  = bsData.filter((r) => r.account_type === "liability")
    const equityRows     = bsData.filter((r) => r.account_type === "equity")
    const totalAssets     = Math.round(assetRows.reduce((s, r) => s + Number(r.balance ?? 0), 0) * 100) / 100
    const totalLiabilities = Math.round(liabilityRows.reduce((s, r) => s + Number(r.balance ?? 0), 0) * 100) / 100
    const totalEquity     = Math.round(equityRows.reduce((s, r) => s + Number(r.balance ?? 0), 0) * 100) / 100
    const adjustedEquity  = Math.round((totalEquity + netProfit) * 100) / 100

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
      .text(`${businessName}   |   ${resolvedPeriod.period_start} to ${resolvedPeriod.period_end}${currencyCode ? "   |   " + currencyCode : ""}`, margin)
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
      .text(`${businessName}   |   As at ${resolvedPeriod.period_end}${currencyCode ? "   |   " + currencyCode : ""}`, margin)
    doc.fillColor("#000000").moveDown(0.4)

    sectionHeading("Assets")
    tableHeader(["Code", "Account", "Balance"])
    assetRows.forEach((r, i) => {
      tableRow(r.account_code ?? "", r.account_name ?? "", fmt(r.balance), i % 2 === 1)
    })
    totalRow("Total Assets", fmt(totalAssets))

    doc.moveDown(0.6)
    sectionHeading("Liabilities")
    tableHeader(["Code", "Account", "Balance"])
    liabilityRows.forEach((r, i) => {
      tableRow(r.account_code ?? "", r.account_name ?? "", fmt(r.balance), i % 2 === 1)
    })
    totalRow("Total Liabilities", fmt(totalLiabilities))

    doc.moveDown(0.6)
    sectionHeading(equitySectionTitle)
    tableHeader(["Code", "Account", "Balance"])
    equityRows.forEach((r, i) => {
      tableRow(r.account_code ?? "", r.account_name ?? "", fmt(r.balance), i % 2 === 1)
    })
    // Always show net income/loss as a visible line in the equity section
    if (netProfit !== 0) {
      tableRow("", netIncomeLabel, fmt(netProfit), equityRows.length % 2 === 1)
    }
    totalRow(`Total ${equitySectionTitle}`, fmt(adjustedEquity))

    doc.moveDown(0.4)
    ensureSpace(rowH)
    totalRow("Total Liabilities + " + equitySectionTitle, fmt(Math.round((totalLiabilities + adjustedEquity) * 100) / 100))

    // Balanced indicator
    const isBalanced = Math.abs(totalAssets - (totalLiabilities + adjustedEquity)) < 0.02
    doc.moveDown(0.3)
    doc.fontSize(8).font("Helvetica").fillColor(isBalanced ? "#1a6e3a" : "#c0392b")
      .text(isBalanced ? "✓ Statement is balanced" : `⚠ Imbalance: ${fmt(totalAssets - totalLiabilities - adjustedEquity)}`, margin)
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
