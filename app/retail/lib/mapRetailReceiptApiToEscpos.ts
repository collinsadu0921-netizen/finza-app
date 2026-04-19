import type { ReceiptData } from "@/lib/escpos"
import { getGhanaLegacyView, sumTaxLines } from "@/lib/taxes/readTaxLines"

/** JSON from GET /api/sales-history/[id]/receipt */
export type RetailReceiptApiBody = {
  sale: {
    id: string
    amount: number
    /** Stable sale / receipt identifier (UUID) — shown on receipt and encoded in QR for lookup */
    receipt_lookup_id?: string
    payment_method?: string | null
    payment_status?: string | null
    created_at: string
    description?: string | null
    tax_lines?: unknown
    total_tax?: number | null
    nhil?: number
    getfund?: number
    vat?: number
    change_given?: number | null
    /** Cash tendered (when recorded); used for Amount Tendered on cash receipts */
    cash_received?: number | null
    /** JSON array of { method, amount } from POS split / multi-tender */
    payment_lines?: unknown
    /** Sale-level discount rollups (advanced discounts) */
    subtotal_before_discount?: number | null
    total_discount?: number | null
    cart_discount_amount?: number | null
    is_voided?: boolean
    cashier?: { email?: string | null; full_name?: string | null } | null
    register?: { name?: string | null } | null
    momo_transaction_id?: string | null
    hubtel_transaction_id?: string | null
  }
  sale_items: Array<{
    product_name?: string | null
    name?: string | null
    quantity?: number | null
    qty?: number | null
    unit_price?: number | null
    price?: number | null
    line_total?: number | null
    discount_amount?: number | null
  }>
  business: {
    name: string
    legal_name?: string | null
    trading_name?: string | null
    /** Business profile logo; used on receipt when store has no logo */
    logo_url?: string | null
  }
  store?: { name: string | null; logo_url?: string | null } | null
  customer?: {
    name?: string | null
    phone?: string | null
    email?: string | null
  } | null
  is_parked?: boolean
}

function mapSaleItemToLine(raw: Record<string, unknown>) {
  const qty = Number(raw.quantity ?? raw.qty ?? 1)
  const unit = Number(raw.unit_price ?? raw.price ?? 0)
  const name = String(raw.product_name ?? raw.name ?? "Item")
  const disc = Number(raw.discount_amount ?? 0)
  const gross = qty * unit
  const lineTotal = Number(
    raw.line_total != null && !Number.isNaN(Number(raw.line_total))
      ? raw.line_total
      : Math.max(0, gross - (Number.isFinite(disc) ? disc : 0))
  )
  return {
    name,
    quantity: qty,
    unitPrice: unit,
    lineTotal,
    lineDiscountAmount: Number.isFinite(disc) && disc > 0 ? disc : 0,
  }
}

function businessDisplayName(b: RetailReceiptApiBody["business"]): string {
  const t = b.trading_name?.trim()
  const l = b.legal_name?.trim()
  const n = b.name?.trim()
  return t || l || n || "Business"
}

function normalize(s: string) {
  return s.trim().toLowerCase()
}

/** Short retail-facing receipt reference; full canonical id stays in `qrCodeContent`. */
export function retailReceiptDisplayRef(canonicalSaleId: string): string {
  const raw = canonicalSaleId.trim().toLowerCase()
  const compact = raw.replace(/-/g, "")
  if (compact.length < 8) return raw.toUpperCase()
  if (compact.length <= 13) return compact.toUpperCase()
  return `${compact.slice(0, 8).toUpperCase()}...${compact.slice(-5).toUpperCase()}`
}

function paymentMethodLabelForReceipt(method: string): string {
  const m = method.trim().toLowerCase()
  if (m === "momo" || m === "mobile_money") return "Mobile money"
  if (m === "cash") return "Cash"
  if (m === "card") return "Card"
  if (m === "split" || m === "mixed") return "Split payment"
  return method
}

function parsePaymentLines(raw: unknown): Array<{ method: string; amount: number }> {
  if (!raw) return []
  let arr: unknown[] = []
  if (Array.isArray(raw)) arr = raw
  else if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw) as unknown
      if (Array.isArray(p)) arr = p
    } catch {
      return []
    }
  }
  return arr
    .map((row) => {
      const r = row as Record<string, unknown>
      const method = String(r.method ?? "").trim()
      const amount = Number(r.amount ?? 0)
      if (!method || Number.isNaN(amount) || amount <= 0) return null
      return { method, amount }
    })
    .filter((x): x is { method: string; amount: number } => x != null)
}

export function mapRetailReceiptApiToEscpos(
  body: RetailReceiptApiBody,
  currencyCode: string,
  currencySymbol: string
): ReceiptData {
  const { sale, sale_items, business } = body
  const items = (sale_items ?? []).map((row) =>
    mapSaleItemToLine(row as Record<string, unknown>)
  )

  const totalDiscountRaw = Math.max(0, Number(sale.total_discount ?? 0) || 0)
  const sumLineDisc = items.reduce((s, i) => s + (i.lineDiscountAmount || 0), 0)
  const totalDiscount =
    totalDiscountRaw > 0.005 ? totalDiscountRaw : sumLineDisc > 0.005 ? sumLineDisc : 0
  const cartDiscountAmt = Math.max(0, Number(sale.cart_discount_amount ?? 0) || 0)
  const subtotalBeforeDiscountRaw = sale.subtotal_before_discount
  const subtotalBeforeDiscountFromSale =
    subtotalBeforeDiscountRaw != null && !Number.isNaN(Number(subtotalBeforeDiscountRaw))
      ? Number(subtotalBeforeDiscountRaw)
      : undefined
  /** List price before discounts — used when sale row did not persist subtotal_before_discount */
  const listGrossFromItems = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
  const subtotalBeforeDiscount =
    subtotalBeforeDiscountFromSale != null && subtotalBeforeDiscountFromSale > 0.005
      ? subtotalBeforeDiscountFromSale
      : totalDiscount > 0.005 && listGrossFromItems > 0.005
        ? listGrossFromItems
        : undefined

  const paymentBreakdown = parsePaymentLines(sale.payment_lines)
  const rawPm = String(sale.payment_method ?? "").trim().toLowerCase()
  const useSplitReceipt =
    paymentBreakdown.length > 1 ||
    rawPm === "split" ||
    rawPm === "mixed"

  const taxFromLines = getGhanaLegacyView(sale.tax_lines)
  const totalTaxFromLines =
    sale.total_tax != null
      ? Number(sale.total_tax)
      : sale.tax_lines
        ? sumTaxLines(sale.tax_lines)
        : taxFromLines.vat +
          taxFromLines.nhil +
          taxFromLines.getfund +
          taxFromLines.covid

  const amount = Number(sale.amount ?? 0)
  const subtotal = Math.max(0, amount - totalTaxFromLines)

  const nhilDisplay =
    taxFromLines.nhil > 0 ? taxFromLines.nhil : Number(sale.nhil ?? 0)
  const getfundDisplay =
    taxFromLines.getfund > 0 ? taxFromLines.getfund : Number(sale.getfund ?? 0)
  const vatDisplay =
    taxFromLines.vat > 0 ? taxFromLines.vat : Number(sale.vat ?? 0)

  const cashierName =
    sale.cashier?.full_name?.trim() ||
    sale.cashier?.email?.trim() ||
    "Cashier"

  const dateTime = new Date(sale.created_at).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })

  const registerHint = sale.register?.name?.trim() || ""

  const bizTitle = businessDisplayName(business)
  let storeName: string | undefined
  const sn = body.store?.name?.trim()
  if (sn && normalize(sn) !== normalize(bizTitle)) {
    storeName = sn
  }

  const storeLogo = body.store?.logo_url?.trim()
  const businessLogo = business.logo_url?.trim()
  const headerLogoUrl = storeLogo || businessLogo || undefined

  const lookupId = (sale.receipt_lookup_id || sale.id).trim().toLowerCase()
  const receiptNumber = retailReceiptDisplayRef(lookupId)

  const paymentRefLines: string[] = []
  const mt = sale.momo_transaction_id?.trim()
  const ht = sale.hubtel_transaction_id?.trim()
  if (mt) paymentRefLines.push(`MoMo txn: ${mt}`)
  if (ht) paymentRefLines.push(`Card ref: ${ht}`)

  let customerName: string | undefined
  let customerPhone: string | undefined
  let customerEmail: string | undefined
  const c = body.customer
  if (c) {
    if (c.name?.trim()) customerName = c.name.trim()
    if (c.phone?.trim()) customerPhone = c.phone.trim()
    if (c.email?.trim()) customerEmail = c.email.trim()
  }

  let saleStatusBanner: string | undefined
  if (sale.is_voided) {
    saleStatusBanner = "VOIDED — NOT VALID FOR RETURN"
  } else {
    const ps = (sale.payment_status || "").toLowerCase()
    if (ps === "refunded" || ps === "partially_refunded") {
      saleStatusBanner =
        ps === "partially_refunded" ? "PARTIALLY REFUNDED" : "REFUNDED"
    }
  }

  const paymentMethodLabel = useSplitReceipt
    ? "Split payment"
    : paymentMethodLabelForReceipt(String(sale.payment_method ?? "unknown"))
  const pmNorm = (useSplitReceipt ? "split" : paymentMethodLabel).trim().toLowerCase()

  let amountTendered: number | undefined
  if (sale.cash_received != null) {
    const cr = Number(sale.cash_received)
    if (!Number.isNaN(cr) && cr > 0 && (pmNorm === "cash" || useSplitReceipt)) {
      amountTendered = cr
    }
  }

  const changeVal =
    sale.change_given != null ? Number(sale.change_given) : undefined

  return {
    businessName: bizTitle,
    storeName,
    /** Public URL or data URL; shown only when receipt settings enable logo. Store logo wins over business logo. */
    logo: headerLogoUrl,
    /** Short display (e.g. 8AC66619…94400); scan uses full UUID in `qrCodeContent`. */
    receiptNumber,
    /** Full canonical sale UUID for QR and exact lookup */
    qrCodeContent: lookupId,
    customerName,
    customerPhone,
    customerEmail,
    saleStatusBanner,
    dateTime,
    registerSessionId: registerHint || undefined,
    cashierName,
    items,
    subtotal,
    totalPayable: amount,
    paymentMethod: paymentMethodLabel,
    paymentBreakdown: useSplitReceipt ? paymentBreakdown : undefined,
    amountTendered,
    changeGiven: changeVal,
    nhil: nhilDisplay,
    getfund: getfundDisplay,
    vat: vatDisplay,
    covid: 0,
    vatInclusive: totalTaxFromLines > 0,
    currencyCode: currencyCode.trim(),
    currencySymbol: currencySymbol.trim(),
    totalDiscount: totalDiscount > 0.005 ? totalDiscount : undefined,
    cartDiscountAmount: cartDiscountAmt > 0 ? cartDiscountAmt : undefined,
    subtotalBeforeDiscount:
      subtotalBeforeDiscount !== undefined && subtotalBeforeDiscount > 0.005
        ? subtotalBeforeDiscount
        : undefined,
    paymentReferenceLines: paymentRefLines.length > 0 ? paymentRefLines : undefined,
  }
}
