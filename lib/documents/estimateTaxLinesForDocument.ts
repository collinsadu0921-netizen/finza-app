import type { TaxLine } from "@/lib/taxEngine/types"

const num = (v: unknown) => Number(v ?? 0)

type EstimateTaxSource = {
  tax_lines?: unknown
  nhil_amount?: unknown
  nhil?: unknown
  getfund_amount?: unknown
  getfund?: unknown
  covid_amount?: unknown
  covid?: unknown
  vat_amount?: unknown
  vat?: unknown
  total_tax_amount?: unknown
  total_tax?: unknown
  tax?: unknown
}

/**
 * Parse stored estimate tax (canonical JSONB `{ lines: [...] }`, legacy shapes, or amount columns)
 * into TaxLine[] for PDF / FinancialDocument and public quote UI.
 */
export function taxLinesFromEstimateRow(estimate: EstimateTaxSource): TaxLine[] {
  const out: TaxLine[] = []
  const raw = estimate.tax_lines

  let lines: any[] = []
  if (raw != null && typeof raw === "object") {
    if (Array.isArray((raw as { lines?: unknown }).lines)) {
      lines = (raw as { lines: any[] }).lines
    } else if (Array.isArray(raw)) {
      lines = raw as any[]
    } else if (Array.isArray((raw as { tax_lines?: unknown }).tax_lines)) {
      lines = (raw as { tax_lines: any[] }).tax_lines
    }
  } else if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw) as { lines?: any[] } | any[]
      if (p && typeof p === "object" && !Array.isArray(p) && Array.isArray((p as { lines?: any[] }).lines)) {
        lines = (p as { lines: any[] }).lines
      } else if (Array.isArray(p)) {
        lines = p
      }
    } catch {
      /* ignore */
    }
  }

  for (const l of lines) {
    const amount = num(l?.amount)
    if (!Number.isFinite(amount) || amount === 0) continue
    const code = String(l?.code ?? "")
    if (code.toUpperCase() === "COVID") continue
    out.push({
      code: code || `TAX_${out.length}`,
      amount,
      ...(l?.rate != null && Number.isFinite(Number(l.rate)) ? { rate: Number(l.rate) } : {}),
      ...(l?.name != null ? { name: String(l.name) } : {}),
    })
  }

  if (out.length > 0) return out

  const nhil = num(estimate.nhil_amount ?? estimate.nhil)
  const getfund = num(estimate.getfund_amount ?? estimate.getfund)
  const covid = num(estimate.covid_amount ?? estimate.covid)
  const vat = num(estimate.vat_amount ?? estimate.vat)

  if (nhil > 0) out.push({ code: "NHIL", name: "NHIL (2.5%)", amount: nhil })
  if (getfund > 0) out.push({ code: "GETFUND", name: "GETFund (2.5%)", amount: getfund })
  if (covid > 0) out.push({ code: "COVID", name: "COVID Levy (1%)", amount: covid })
  if (vat > 0) out.push({ code: "VAT", name: "VAT (15%)", amount: vat })

  const totalTax = num(estimate.total_tax_amount ?? estimate.total_tax ?? estimate.tax)
  if (out.length === 0 && totalTax > 0) {
    out.push({ code: "TAX", name: "Tax", amount: totalTax })
  }

  return out
}
