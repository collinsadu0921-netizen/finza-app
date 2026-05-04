import "server-only"

import { NextResponse } from "next/server"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { normalizeCountry, assertMethodAllowed, UNSUPPORTED_COUNTRY_MARKER } from "@/lib/payments/eligibility"
import { getTaxEngineCode } from "@/lib/taxEngine/helpers"
import { calculateTaxes } from "@/lib/taxEngine"
import type { LineItem as TaxEngineLineItem } from "@/lib/taxEngine/types"
import { calculateDiscounts, type LineDiscount, type CartDiscount } from "@/lib/discounts/calculator"
import {
  validateLineDiscount,
  validateCartDiscount,
  validateTotalDiscount,
  getRoleDiscountLimit,
  type DiscountCaps,
  type RoleDiscountLimit,
} from "@/lib/discounts/validation"
import type { UserRole as AuthorityUserRole } from "@/lib/authority"
import { type UserRole } from "@/lib/userRoles"
import { assertBusinessNotArchived } from "@/lib/archivedBusiness"
import type { RetailMomoCartSnapshot } from "@/lib/retail/pos/retailMomoCartFingerprint"
import { computeServerRetailMomoFingerprint } from "@/lib/retail/pos/retailMomoFingerprintServer"

const supabaseEngine = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

/** POS sends `taxResultToJSONB`: object with `tax_total` and nested `tax_lines`; tolerate legacy shapes. */
function parseClientTaxTotalFromPayload(taxLines: unknown): number {
  if (taxLines == null) return 0
  if (Array.isArray(taxLines)) {
    return taxLines.reduce((s, row: { amount?: unknown }) => s + Number(row?.amount ?? 0), 0)
  }
  if (typeof taxLines !== "object") return 0
  const obj = taxLines as Record<string, unknown>
  if (typeof obj.tax_total === "number" && Number.isFinite(obj.tax_total)) return obj.tax_total
  if (typeof obj.tax_total === "string") {
    const n = Number(obj.tax_total)
    return Number.isFinite(n) ? n : 0
  }
  if (Array.isArray(obj.lines)) {
    return (obj.lines as Array<{ amount?: unknown }>).reduce((s, row) => s + Number(row?.amount ?? 0), 0)
  }
  if (Array.isArray(obj.tax_lines)) {
    return (obj.tax_lines as Array<{ amount?: unknown }>).reduce((s, row) => s + Number(row?.amount ?? 0), 0)
  }
  return 0
}

const RETAIL_TAX_TOTAL_TOLERANCE = 0.05

const getServiceRoleClient = () => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Service role key required for stock movements")
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

/** Captured during stock deduction; used only for compensating rollback (do not re-read live DB). */
type StockCompensationEntry = {
  products_stock_id: string
  prior_stock: number
  created_during_sale: boolean
}

/**
 * P0 rollback: reverse operational effects after ledger/reconciliation failure.
 * Order: stock_movements → products_stock → journal_entries → sale_items → sales.
 */
async function compensateFailedRetailSale(params: {
  supabase: SupabaseClient
  saleId: string
  businessId: string
  stockEntries: StockCompensationEntry[]
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const sr = getServiceRoleClient()

  const { error: movErr } = await sr
    .from("stock_movements")
    .delete()
    .eq("related_sale_id", params.saleId)
    .eq("business_id", params.businessId)

  if (movErr) {
    return { ok: false, message: movErr.message || String(movErr) }
  }

  for (const e of params.stockEntries) {
    if (e.created_during_sale) {
      const { error } = await params.supabase.from("products_stock").delete().eq("id", e.products_stock_id)
      if (error) {
        return { ok: false, message: error.message || String(error) }
      }
    } else {
      const { error } = await params.supabase
        .from("products_stock")
        .update({
          stock: e.prior_stock,
          stock_quantity: e.prior_stock,
        })
        .eq("id", e.products_stock_id)
      if (error) {
        return { ok: false, message: error.message || String(error) }
      }
    }
  }

  const { error: jeErr } = await params.supabase
    .from("journal_entries")
    .delete()
    .eq("reference_type", "sale")
    .eq("reference_id", params.saleId)

  if (jeErr) {
    return { ok: false, message: jeErr.message || String(jeErr) }
  }

  await params.supabase.from("sale_items").delete().eq("sale_id", params.saleId)
  const { error: saleErr } = await params.supabase.from("sales").delete().eq("id", params.saleId)
  if (saleErr) {
    return { ok: false, message: saleErr.message || String(saleErr) }
  }

  return { ok: true }
}

/** When sale + sale_items exist: undo stock/movements/journal/sale. Use `extraStockEntry` if stock was mutated but not yet appended to `plan` (e.g. movement insert failed). */
async function abortRetailSaleWithCompensation(params: {
  supabase: SupabaseClient
  saleId: string
  businessId: string
  plan: StockCompensationEntry[]
  extraStockEntry?: StockCompensationEntry | null
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const stockEntries =
    params.extraStockEntry != null
      ? [...params.plan, params.extraStockEntry]
      : params.plan
  return compensateFailedRetailSale({
    supabase: params.supabase,
    saleId: params.saleId,
    businessId: params.businessId,
    stockEntries,
  })
}

type PaymentLine = {
  method: "cash" | "momo" | "card"
  amount: number
}

export type RetailSaleCreationAuth =
  | { mode: "session"; businessId: string; userId: string }
  | { mode: "token"; businessId: string; userId: string; storeId: string }

export async function runRetailSaleCreationEngine(
  body: Record<string, unknown>,
  auth: RetailSaleCreationAuth,
  isOfflineSync: boolean
): Promise<NextResponse> {
  const supabase = supabaseEngine
  try {
    const {
      store_id,
      cashier_session_id,
      register_id,
      amount,
      entry_date, // Optional: original timestamp for offline sync (Phase 4)
      subtotal,
      tax_total,
      // Legacy tax fields removed - use tax_lines instead (canonical source)
      // nhil, getfund, covid, vat are NOT written to database
      description,
      payment_method,
      payment_status,
      payments, // Array of PaymentLine
      cash_amount,
      momo_amount,
      card_amount,
      cash_received,
      change_given,
      // Foreign currency fields removed - FX not fully supported end-to-end
      sale_items,
      // Discount fields (Phase 1 - Advanced Discounts)
      // Line item discounts: each item can have discount_type and discount_value
      // Cart discount: applied after line discounts
      cart_discount_type,
      cart_discount_value,
      // Canonical tax fields (from frontend tax calculation)
      // NOTE: Tax must be calculated on NET amounts AFTER discounts
      tax_lines,
      tax_engine_code,
      tax_engine_effective_from,
      tax_jurisdiction,
      apply_taxes, // Optional flag (defaults to true for retail sales with tax amounts)
      customer_id, // Optional customer reference (Phase 1 - identity only)
      // Layaway fields (Phase 2 - Layaway/Installments) - NOT IMPLEMENTED YET
      // is_layaway and deposit_amount are ignored for now - layaway not implemented
      /** Retail POS — MTN MoMo sandbox: finalize only after provider success (see retail API routes). */
      retail_mtn_sandbox_payment_reference,
    } = body as any

    const business_id = auth.businessId
    const user_id = auth.userId

    const retailMomoRef =
      typeof retail_mtn_sandbox_payment_reference === "string"
        ? retail_mtn_sandbox_payment_reference.trim()
        : ""
    let retailMomoTxnId: string | null = null

    if (auth.mode === "token" && retailMomoRef) {
      return NextResponse.json(
        {
          error: "This checkout path does not support MoMo finalize.",
          code: "NOT_SUPPORTED_PIN_POS",
        },
        { status: 400 }
      )
    }

    if (!amount) {
      return NextResponse.json(
        { error: "Missing required fields: amount" },
        { status: 400 }
      )
    }

    // Layaway is not implemented yet - all sales are normal (full payment)
    // Layaway validation and logic removed until Phase 2 is fully implemented

    // Require register_id for all sales
    // For offline sync, we skip register session validation (session may be closed by now)
    // but still require register_id and business_id for data integrity
    if (!register_id) {
      return NextResponse.json(
        { error: "Register is required. Please open a register session first." },
        { status: 400 }
      )
    }

    // Register session validation for online sales runs after finalStoreId is resolved (below).

    // Validate payments if provided
    if (payments && Array.isArray(payments)) {
      const paymentsTotal = payments.reduce(
        (sum: number, p: PaymentLine) => sum + Number(p.amount || 0),
        0
      )
      const difference = Math.abs(paymentsTotal - amount)
      if (difference > 0.01) {
        return NextResponse.json(
          { error: `Payment total (${paymentsTotal.toFixed(2)}) does not match sale amount (${amount.toFixed(2)})` },
          { status: 400 }
        )
      }
    }

    // Load business to check country eligibility and get owner_id for system accountant
    const { data: businessRow } = await supabase
      .from("businesses")
      .select("id, address_country, owner_id, industry")
      .eq("id", business_id)
      .single()

    if (!businessRow) {
      return NextResponse.json(
        { error: "Business not found" },
        { status: 404 }
      )
    }

    if (String(businessRow.industry || "").toLowerCase() !== "retail") {
      return NextResponse.json(
        {
          error: "Sales API is only available for retail businesses.",
          code: "SALES_RETAIL_ONLY",
        },
        { status: 403 }
      )
    }

    if (!businessRow.owner_id) {
      return NextResponse.json(
        { error: "Business owner not found. Cannot post sale to ledger without system accountant." },
        { status: 500 }
      )
    }

    try {
      await assertBusinessNotArchived(supabase, business_id)
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || "Business is archived" }, { status: 403 })
    }

    // Check payment method eligibility by country
    const countryCode = normalizeCountry(businessRow.address_country)
    
    // HARD VALIDATION GUARD: Reject sale creation if taxes are applied but canonical tax data is missing
    // Retail sales always have taxes applied (tax-inclusive mode)
    // For retail, apply_taxes defaults to true if not explicitly set to false
    const taxesApplied = apply_taxes !== false
    
    if (taxesApplied) {
      // If taxes are applied, all canonical tax fields must be provided
      // Check both direct array format and object with 'lines' key for tax_lines
      const isEmptyArray = Array.isArray(tax_lines) && tax_lines.length === 0
      const isEmptyObject = typeof tax_lines === 'object' && tax_lines !== null && 
                            tax_lines.lines && Array.isArray(tax_lines.lines) && tax_lines.lines.length === 0
      
      // Validate tax_lines is present and not empty
      if (!tax_lines || isEmptyArray || isEmptyObject) {
        return NextResponse.json(
          {
            error: "Tax lines are required when taxes are applied. Please ensure tax calculation data is included in the request.",
            code: "MISSING_TAX_LINES",
            details: "post_sale_to_ledger requires tax_lines to post tax liabilities correctly"
          },
          { status: 422 }
        )
      }
      
      // Validate canonical tax metadata is present (required for audit trail)
      if (!tax_engine_code || !tax_engine_effective_from || !tax_jurisdiction) {
        return NextResponse.json(
          {
            error: "Canonical tax metadata is required when taxes are applied. Missing: tax_engine_code, tax_engine_effective_from, or tax_jurisdiction.",
            code: "MISSING_TAX_METADATA",
            details: "All canonical tax fields (tax_lines, tax_engine_code, tax_engine_effective_from, tax_jurisdiction) must be provided when taxes are applied"
          },
          { status: 422 }
        )
      }
    }
    
    // Check payment_method if provided
    if (payment_method) {
      const methodMap: Record<string, "cash" | "card" | "mobile_money" | "bank_transfer"> = {
        "cash": "cash",
        "card": "card",
        "momo": "mobile_money",
        "mtn_momo": "mobile_money",
        "hubtel": "mobile_money",
        "bank": "bank_transfer",
      }
      
      const normalizedMethod = methodMap[payment_method]
      
      if (normalizedMethod) {
        try {
          assertMethodAllowed(countryCode, normalizedMethod)
        } catch (error: any) {
          return NextResponse.json(
            { 
              error: error.message || "Payment method/provider not available for your country."
            },
            { status: 403 }
          )
        }
      }
    }

    // Check payment lines if provided
    if (payments && Array.isArray(payments)) {
      const methodMap: Record<string, "cash" | "card" | "mobile_money" | "bank_transfer"> = {
        "cash": "cash",
        "card": "card",
        "momo": "mobile_money",
        "mtn_momo": "mobile_money",
        "hubtel": "mobile_money",
        "bank": "bank_transfer",
      }
      
      for (const payment of payments) {
        const normalizedMethod = methodMap[payment.method]
        if (normalizedMethod) {
          try {
            assertMethodAllowed(countryCode, normalizedMethod)
          } catch (error: any) {
            return NextResponse.json(
              { 
                error: error.message || "Payment method/provider not available for your country."
              },
              { status: 403 }
            )
          }
        }
      }
    }

    // Get user role to enforce store restrictions
    const { data: businessUser, error: businessUserError } = await supabase
      .from("business_users")
      .select("role")
      .eq("business_id", business_id)
      .eq("user_id", user_id)
      .maybeSingle()
    
    if (businessUserError) {
      console.error("Error fetching user role:", businessUserError)
      const errorResponse = { 
        error: `Failed to fetch user role: ${businessUserError.message}`, 
        code: "ROLE_FETCH_ERROR",
        details: businessUserError
      }
      console.log("Returning 500 error response:", JSON.stringify(errorResponse, null, 2))
      return NextResponse.json(errorResponse, { status: 500 })
    }
    
    const userRole = businessUser?.role || null
    
    // If user has no role in business_users, they might be a cashier (PIN login)
    // Cashiers might not have a business_users record, so check users table
    if (!userRole) {
      console.warn("User has no role in business_users, checking if cashier:", { user_id, business_id })
      // For cashiers, we'll allow them to proceed but they must have a store_id assigned
      // The store validation below will catch if they don't have a store
    }
    
    console.log("Sale creation - user role check:", {
      user_id,
      business_id,
      userRole,
      active_store_id: body.active_store_id,
      store_id: store_id,
      register_id: register_id,
      businessUser: businessUser
    })
    
    let finalStoreId: string

    if (auth.mode === "token") {
      const scopeBid = body.business_id != null ? String(body.business_id) : ""
      const scopeSid = body.store_id != null ? String(body.store_id) : ""
      const scopeAid =
        body.active_store_id != null && body.active_store_id !== undefined
          ? String(body.active_store_id)
          : ""
      if (scopeBid && scopeBid !== auth.businessId) {
        return NextResponse.json(
          { error: "Request scope does not match authorization.", code: "BAD_SCOPE" },
          { status: 400 }
        )
      }
      if (scopeSid && scopeSid !== auth.storeId) {
        return NextResponse.json(
          { error: "Request scope does not match authorization.", code: "BAD_SCOPE" },
          { status: 400 }
        )
      }
      if (scopeAid && scopeAid !== "all" && scopeAid !== auth.storeId) {
        return NextResponse.json(
          { error: "Request scope does not match authorization.", code: "BAD_SCOPE" },
          { status: 400 }
        )
      }

      finalStoreId = auth.storeId
      if (!finalStoreId || finalStoreId === "all") {
        return NextResponse.json(
          { error: "Cannot create sale: Invalid store context.", code: "BAD_SCOPE" },
          { status: 400 }
        )
      }
    } else {
      // Get store_id - Priority: 1) active_store_id from body, 2) store_id from body, 3) register.store_id
      // NEVER use user.store_id - active_store_id from session is the single source of truth
      // IMPORTANT: Always set store_id when creating a sale (do not leave it null)
      finalStoreId = (body.active_store_id || store_id) as string

      // Debug logging
      console.log("Sale creation - store_id resolution:", {
        active_store_id: body.active_store_id,
        store_id: store_id,
        finalStoreId: finalStoreId,
        register_id: register_id,
      })

      // If active_store_id is "all", we cannot create a sale - must select a specific store
      if (finalStoreId === "all") {
        return NextResponse.json(
          { error: "Cannot create sale: Please select a specific store (not 'All Stores')." },
          { status: 400 }
        )
      }

      if (!finalStoreId) {
        // Try to get store_id from register if register_id is provided
        if (register_id) {
          const { data: register } = await supabase
            .from("registers")
            .select("store_id")
            .eq("id", register_id)
            .maybeSingle()

          if (register?.store_id) {
            finalStoreId = register.store_id
          } else {
            // Register exists but has no store_id - this is an error
            return NextResponse.json(
              {
                error: `Register ${register_id} is not assigned to a store. Please assign it to a store first.`,
              },
              { status: 400 }
            )
          }
        }
      }
    }
    
    // Verify register belongs to the store (if both are provided)
    if (register_id && finalStoreId) {
      const { data: register } = await supabase
        .from("registers")
        .select("store_id")
        .eq("id", register_id)
        .maybeSingle()
      
      if (register && register.store_id && register.store_id !== finalStoreId) {
        console.error("Register-store mismatch:", {
          register_id,
          register_store_id: register.store_id,
          finalStoreId
        })
        return NextResponse.json(
          { error: `Access denied: Register does not belong to the selected store. Register's store: ${register.store_id}, Selected: ${finalStoreId}` },
          { status: 403 }
        )
      }
    }
    
    // CRITICAL: Do NOT proceed if store_id is still null
    // Do NOT fallback to user.store_id - this breaks multi-store functionality
    if (!finalStoreId) {
      return NextResponse.json(
        { error: "Cannot create sale: No store_id available. Please select a store first using the store switcher." },
        { status: 400 }
      )
    }

    // CRITICAL VALIDATION: Ensure store_id is set before creating sale
    // This prevents any sale from being created with NULL store_id
    if (!finalStoreId || finalStoreId === 'all') {
      return NextResponse.json(
        { error: "Cannot create sale: Invalid store_id. Please select a specific store." },
        { status: 400 }
      )
    }
    
    // ROLE-BASED VALIDATION: Store managers and cashiers must use their assigned store
    // Also validate users with no role (might be cashiers without business_users record)
    // PIN token path: store is fixed by token; skip users.store_id enforcement (validated at PIN issue).
    if (
      auth.mode === "session" &&
      (userRole === "manager" || userRole === "cashier" || !userRole)
    ) {
      console.log("Checking store assignment:", { user_id, userRole, finalStoreId, hasRole: !!userRole })
      
      const { data: userData, error: userDataError } = await supabase
        .from("users")
        .select("store_id")
        .eq("id", user_id)
        .maybeSingle()
      
      if (userDataError) {
        console.error("Error fetching user store_id:", userDataError)
        const errorResponse = { 
          error: `Failed to verify user store assignment: ${userDataError.message}`,
          code: "USER_STORE_FETCH_ERROR",
          details: userDataError
        }
        console.log("Returning 500 error:", JSON.stringify(errorResponse, null, 2))
        return NextResponse.json(errorResponse, { status: 500 })
      }
      
      console.log("User store data:", { user_id, userData, finalStoreId, userRole })
      
      if (!userData?.store_id) {
        console.error("User has no store_id assigned:", { user_id, userRole, finalStoreId })
        const errorResponse = { 
          error: "Cannot create sale: You must be assigned to a store. Please contact your administrator.",
          code: "NO_STORE_ASSIGNED",
          user_id,
          userRole
        }
        console.log("Returning 403 error:", JSON.stringify(errorResponse, null, 2))
        return NextResponse.json(errorResponse, { status: 403 })
      }
      
      // Enforce: Store users can ONLY create sales for their assigned store
      if (finalStoreId !== userData.store_id) {
        console.error("Store mismatch:", { 
          user_id, 
          userRole, 
          assignedStoreId: userData.store_id, 
          requestedStoreId: finalStoreId 
        })
        const errorResponse = { 
          error: `Access denied: You can only create sales for your assigned store. Your store: ${userData.store_id}, Requested: ${finalStoreId}`,
          code: "STORE_MISMATCH",
          assignedStoreId: userData.store_id,
          requestedStoreId: finalStoreId,
          user_id,
          userRole
        }
        console.log("Returning 403 error:", JSON.stringify(errorResponse, null, 2))
        return NextResponse.json(errorResponse, { status: 403 })
      }
      
      console.log("Store validation passed")
    }

    // Online sales: require an open register session for this register + store
    if (!isOfflineSync) {
      let sessionQuery = supabase
        .from("cashier_sessions")
        .select("id")
        .eq("business_id", business_id)
        .eq("register_id", register_id)
        .eq("store_id", finalStoreId)
        .eq("status", "open")
      if (auth.mode === "token") {
        sessionQuery = sessionQuery.eq("user_id", user_id)
      }
      if (cashier_session_id) {
        sessionQuery = sessionQuery.eq("id", cashier_session_id)
      }
      const { data: openRegSession, error: regSessionErr } = await sessionQuery.maybeSingle()

      if (regSessionErr) {
        console.error("Register session lookup failed:", regSessionErr)
        return NextResponse.json(
          {
            error: "Could not verify register session. Try again or reopen the register.",
            code: "REGISTER_NOT_OPEN",
            details: regSessionErr.message,
          },
          { status: 500 }
        )
      }

      if (!openRegSession) {
        return NextResponse.json(
          {
            error: "No open register session for this register and store. Open a register before selling.",
            code: "REGISTER_NOT_OPEN",
          },
          { status: 403 }
        )
      }
    }

    // ---------------------------------------------------------------------------
    // Retail MTN MoMo sandbox — require confirmed provider txn before sale insert
    // ---------------------------------------------------------------------------
    if (retailMomoRef) {
      const { data: momoTxn, error: momoTxnErr } = await supabase
        .from("payment_provider_transactions")
        .select("id, status, sale_id, amount_minor, request_payload, workspace")
        .eq("business_id", business_id)
        .eq("reference", retailMomoRef)
        .eq("workspace", "retail")
        .maybeSingle()

      if (momoTxnErr || !momoTxn) {
        return NextResponse.json(
          { error: "MoMo payment reference not found", code: "MOMO_TXN_NOT_FOUND" },
          { status: 404 },
        )
      }

      const req = (momoTxn.request_payload ?? {}) as Record<string, unknown>
      if (req.kind !== "retail_pos_momo_sandbox") {
        return NextResponse.json({ error: "Invalid MoMo payment reference" }, { status: 400 })
      }

      if (momoTxn.sale_id) {
        console.log("[retail-momo-sandbox] idempotent sale finalize", {
          reference: retailMomoRef,
          sale_id: momoTxn.sale_id,
        })
        return NextResponse.json({
          success: true,
          sale_id: momoTxn.sale_id,
          message: "Sale already recorded for this payment",
          idempotent: true,
        })
      }

      if (momoTxn.status !== "successful") {
        return NextResponse.json(
          {
            error: "Mobile Money payment is not confirmed successful yet",
            code: "MOMO_NOT_SUCCESSFUL",
            status: momoTxn.status,
          },
          { status: 402 },
        )
      }

      const expectedPesewas = Math.round(Number(amount) * 100)
      const storedMinor = Number(momoTxn.amount_minor ?? 0)
      if (Math.abs(storedMinor - expectedPesewas) > 1) {
        return NextResponse.json(
          {
            error: "Sale total does not match the MoMo payment amount",
            code: "MOMO_AMOUNT_MISMATCH",
          },
          { status: 400 },
        )
      }

      const snapRaw = req.cart_snapshot
      if (!snapRaw || typeof snapRaw !== "object" || !Array.isArray((snapRaw as { items?: unknown }).items)) {
        return NextResponse.json(
          {
            error: "MoMo payment attempt is missing cart_snapshot; create a new payment attempt.",
            code: "MOMO_CART_SNAPSHOT_REQUIRED",
          },
          { status: 400 },
        )
      }
      const cartSnapshot = snapRaw as RetailMomoCartSnapshot
      let recomputedFp: string
      try {
        recomputedFp = computeServerRetailMomoFingerprint(cartSnapshot, Number(amount))
      } catch {
        return NextResponse.json(
          { error: "Could not validate cart snapshot for MoMo finalize", code: "MOMO_CART_SNAPSHOT_INVALID" },
          { status: 400 },
        )
      }
      if (recomputedFp !== String(req.server_cart_fingerprint ?? "")) {
        return NextResponse.json(
          {
            error: "Cart or total no longer matches the MoMo payment attempt",
            code: "MOMO_FINGERPRINT_MISMATCH",
          },
          { status: 400 },
        )
      }

      if (String(req.store_id ?? "") !== String(finalStoreId)) {
        return NextResponse.json(
          { error: "Store does not match the MoMo payment attempt", code: "MOMO_STORE_MISMATCH" },
          { status: 400 },
        )
      }

      if (String(req.register_id ?? "") !== String(register_id ?? "")) {
        return NextResponse.json(
          { error: "Register does not match the MoMo payment attempt", code: "MOMO_REGISTER_MISMATCH" },
          { status: 400 },
        )
      }

      const bodySession = cashier_session_id != null && cashier_session_id !== "" ? String(cashier_session_id) : ""
      const txnSession =
        req.cashier_session_id != null && String(req.cashier_session_id) !== ""
          ? String(req.cashier_session_id)
          : ""
      if (bodySession !== txnSession) {
        return NextResponse.json(
          { error: "Register session does not match the MoMo payment attempt", code: "MOMO_SESSION_MISMATCH" },
          { status: 400 },
        )
      }

      retailMomoTxnId = momoTxn.id as string
    }

    // ============================================================================
    // DISCOUNT CALCULATION (Phase 1 - Ledger-Safe Pricing)
    // ============================================================================
    // Calculate discounts BEFORE tax calculation and ledger posting
    // All discount amounts are computed and stored as immutable values
    // ============================================================================
    
    let discountCalculation: ReturnType<typeof calculateDiscounts> | null = null
    let computedDiscountFields: {
      subtotal_before_discount?: number
      total_discount?: number
      subtotal_after_discount?: number
      cart_discount_type?: string
      cart_discount_value?: number
      cart_discount_amount?: number
    } = {}

    if (sale_items && Array.isArray(sale_items) && sale_items.length > 0) {
      // ============================================================================
      // DISCOUNT VALIDATION (Phase 1 - Advanced Discounts)
      // ============================================================================
      // Enforce discount caps and role-based limits BEFORE calculation
      // Never trust UI alone - API must validate all discounts
      // ============================================================================
      
      // Get business discount caps and role limits
      const { data: businessData, error: businessError } = await supabase
        .from("businesses")
        .select("max_discount_percent, max_discount_amount, max_discount_per_sale_percent, max_discount_per_sale_amount, max_discount_per_line_percent, max_discount_per_line_amount, discount_role_limits")
        .eq("id", business_id)
        .maybeSingle()

      if (businessError) {
        console.error("Error fetching business discount caps:", businessError)
        // Continue without validation if business data can't be fetched (shouldn't happen)
      }

      // Get user role for role-based limit checking (already fetched above)
      // Check if user is owner
      const { data: businessOwner } = await supabase
        .from("businesses")
        .select("owner_id")
        .eq("id", business_id)
        .maybeSingle()
      
      const finalUserRole: UserRole = businessOwner?.owner_id === user_id 
        ? "owner" 
        : (userRole as UserRole)

      // Prepare discount caps
      const caps: DiscountCaps = {
        max_discount_percent: businessData?.max_discount_percent ?? null,
        max_discount_amount: businessData?.max_discount_amount ?? null,
        max_discount_per_sale_percent: businessData?.max_discount_per_sale_percent ?? null,
        max_discount_per_sale_amount: businessData?.max_discount_per_sale_amount ?? null,
        max_discount_per_line_percent: businessData?.max_discount_per_line_percent ?? null,
        max_discount_per_line_amount: businessData?.max_discount_per_line_amount ?? null,
      }

      // Get role-based discount limit
      const roleLimits = businessData?.discount_role_limits as Record<string, RoleDiscountLimit> | null | undefined
      const roleLimit = getRoleDiscountLimit(roleLimits, userRole)

      // Prepare line items for discount calculation
      const lineItemsForDiscount = sale_items.map((item: any) => ({
        quantity: Number(item.quantity || item.qty || 1),
        unit_price: Number(item.unit_price || item.price || 0),
        discount: item.discount_type && item.discount_type !== 'none'
          ? {
              discount_type: item.discount_type as 'none' | 'percent' | 'amount',
              discount_value: Number(item.discount_value || 0),
            }
          : undefined,
      }))

      // Validate each line discount
      for (let i = 0; i < lineItemsForDiscount.length; i++) {
        const item = lineItemsForDiscount[i]
        const saleItem = sale_items[i]
        
        if (item.discount && item.discount.discount_type !== 'none') {
          const lineTotal = item.quantity * item.unit_price
          const validation = validateLineDiscount(
            item.discount,
            lineTotal,
            caps,
            roleLimit,
            finalUserRole as AuthorityUserRole
          )

          if (!validation.valid) {
            return NextResponse.json(
              { error: validation.error || "Line discount validation failed" },
              { status: 403 }
            )
          }
        }
      }

      // Prepare cart discount
      const cartDiscount: CartDiscount | undefined = cart_discount_type && cart_discount_type !== 'none'
        ? {
            discount_type: cart_discount_type as 'none' | 'percent' | 'amount',
            discount_value: Number(cart_discount_value || 0),
          }
        : undefined

      // Calculate subtotal before discounts for cart discount validation
      const subtotalBeforeDiscount = lineItemsForDiscount.reduce(
        (sum, item) => sum + (item.quantity * item.unit_price),
        0
      )

      // Validate cart discount
      if (cartDiscount && cartDiscount.discount_type !== 'none') {
const validation = validateCartDiscount(
        cartDiscount,
        subtotalBeforeDiscount,
        caps,
        roleLimit,
        finalUserRole as AuthorityUserRole
      )

        if (!validation.valid) {
          return NextResponse.json(
            { error: validation.error || "Cart discount validation failed" },
            { status: 403 }
          )
        }
      }

      // Calculate discounts
      discountCalculation = calculateDiscounts(lineItemsForDiscount, cartDiscount)

      // Validate total discount (line + cart) against global caps
      const totalDiscountPercent = subtotalBeforeDiscount > 0
        ? (discountCalculation.total_discount / subtotalBeforeDiscount) * 100
        : 0

      const totalValidation = validateTotalDiscount(
        discountCalculation.total_discount,
        totalDiscountPercent,
        subtotalBeforeDiscount,
        caps
      )

      if (!totalValidation.valid) {
        return NextResponse.json(
          { error: totalValidation.error || "Total discount validation failed" },
          { status: 403 }
        )
      }

      // Store computed discount fields
      computedDiscountFields = {
        subtotal_before_discount: discountCalculation.subtotal_before_discount,
        total_discount: discountCalculation.total_discount,
        subtotal_after_discount: discountCalculation.subtotal_after_discount,
        cart_discount_type: cart_discount_type || null,
        cart_discount_value: cart_discount_value ? Number(cart_discount_value) : 0,
        cart_discount_amount: discountCalculation.cart_discount_amount,
      }

      // VALIDATION: Ensure tax was calculated on net amounts
      // If frontend sent tax_lines, they should be based on subtotal_after_discount
      // We'll trust the frontend calculation but log a warning if mismatch detected
      if (tax_lines && discountCalculation.total_discount > 0) {
        console.log("Discount calculation:", {
          subtotal_before_discount: discountCalculation.subtotal_before_discount,
          subtotal_after_discount: discountCalculation.subtotal_after_discount,
          total_discount: discountCalculation.total_discount,
          note: "Tax should be calculated on subtotal_after_discount",
        })
      }
    }

    // Determine jurisdiction and engine code for canonical tax metadata
    // Use provided tax_jurisdiction if available, otherwise derive from business country
    const jurisdiction = tax_jurisdiction || countryCode || null
    const finalTaxEngineCode = tax_engine_code || (jurisdiction ? getTaxEngineCode(jurisdiction) : null)
    // Use provided effective_from if available, otherwise use current date
    const effectiveDate = tax_engine_effective_from || new Date().toISOString().split('T')[0]

    // ============================================================================
    // RETAIL: Reconcile output tax against DB `products.tax_category`
    // Rebuilds taxable-only net lines (same cart-discount spread as POS) and
    // compares aggregate tax_total to the client payload (does not repost ledger).
    // ============================================================================
    if (
      taxesApplied &&
      tax_lines &&
      discountCalculation &&
      sale_items &&
      Array.isArray(sale_items) &&
      sale_items.length > 0 &&
      jurisdiction &&
      jurisdiction !== UNSUPPORTED_COUNTRY_MARKER &&
      finalTaxEngineCode
    ) {
      const productIds = Array.from(
        new Set(
          (sale_items as any[])
            .map((row) => row?.product_id || row?.productId)
            .filter((id): id is string => typeof id === "string" && id.length > 0)
        )
      )

      if (productIds.length > 0) {
        const { data: productTaxRows, error: productTaxErr } = await supabase
          .from("products")
          .select("id, tax_category")
          .eq("business_id", business_id)
          .in("id", productIds)

        if (!productTaxErr && productTaxRows && productTaxRows.length > 0) {
          const taxCategoryById = new Map<string, string | null>()
          for (const row of productTaxRows) {
            taxCategoryById.set(row.id, row.tax_category ?? null)
          }

          const lineItemsForEngine: TaxEngineLineItem[] = []
          const saleRows = sale_items as any[]

          for (let i = 0; i < saleRows.length; i++) {
            const saleItem = saleRows[i]
            const pid = saleItem?.product_id || saleItem?.productId
            const qty = Math.max(1, Math.floor(Number(saleItem?.quantity || saleItem?.qty || 1)))
            const unitPrice = Number(saleItem?.unit_price || saleItem?.price || 0)
            if (!pid || unitPrice <= 0 || qty <= 0) continue

            const rawCat = taxCategoryById.get(pid)
            const taxCat = (rawCat ?? "taxable").toLowerCase()
            if (taxCat !== "taxable") continue

            const netLine = discountCalculation.lineItems[i]?.net_line
            if (netLine == null || netLine <= 0) continue

            const netUnit = qty > 0 ? netLine / qty : unitPrice
            lineItemsForEngine.push({
              quantity: qty,
              unit_price: netUnit,
              discount_amount: 0,
            })
          }

          if (
            discountCalculation.cart_discount_amount > 0 &&
            discountCalculation.subtotal_after_line_discounts > 0 &&
            lineItemsForEngine.length > 0
          ) {
            const cartDiscountProportion =
              discountCalculation.cart_discount_amount /
              discountCalculation.subtotal_after_line_discounts
            for (const lineItem of lineItemsForEngine) {
              const originalNetLine = lineItem.unit_price * lineItem.quantity
              const cartDiscountAllocation = originalNetLine * cartDiscountProportion
              const finalNetLine = originalNetLine - cartDiscountAllocation
              lineItem.unit_price =
                lineItem.quantity > 0 ? finalNetLine / lineItem.quantity : lineItem.unit_price
            }
          }

          const clientTaxTotal = parseClientTaxTotalFromPayload(tax_lines)

          if (lineItemsForEngine.length === 0) {
            if (clientTaxTotal > RETAIL_TAX_TOTAL_TOLERANCE) {
              return NextResponse.json(
                {
                  error:
                    "Tax amount does not match product tax categories. Exempt or zero-rated lines cannot carry output VAT.",
                  code: "TAX_CATEGORY_MISMATCH",
                },
                { status: 422 }
              )
            }
          } else {
            try {
              const engineDate =
                typeof tax_engine_effective_from === "string" && tax_engine_effective_from.length >= 8
                  ? tax_engine_effective_from
                  : effectiveDate
              const serverResult = calculateTaxes(
                lineItemsForEngine,
                businessRow.address_country,
                engineDate,
                true
              )
              const serverTaxTotal = Number(serverResult.tax_total) || 0
              if (Math.abs(serverTaxTotal - clientTaxTotal) > RETAIL_TAX_TOTAL_TOLERANCE) {
                return NextResponse.json(
                  {
                    error:
                      "Reported tax does not match server calculation for taxable lines and current product tax categories.",
                    code: "TAX_RECONCILIATION_MISMATCH",
                    details: { server_tax_total: serverTaxTotal, client_tax_total: clientTaxTotal },
                  },
                  { status: 422 }
                )
              }
            } catch (e: any) {
              console.warn("Retail tax reconciliation skipped (engine error):", e?.message || e)
            }
          }
        } else if (productTaxErr) {
          console.warn("Retail tax reconciliation: could not load products.tax_category:", productTaxErr.message)
        }
      }
    }
    
    // Create sale record
    const saleData: any = {
      business_id,
      user_id,
      cashier_session_id: cashier_session_id || null,
      register_id: register_id || null,
      amount: Number(amount),
      payment_method: payment_method || "cash",
      payment_status: payment_status || "paid",
      status: "completed", // Set status to "completed" for analytics filtering
      description: description || null,
      // Phase 4: Use entry_date for offline sync (preserve original timestamp)
      // If entry_date is provided, use it for created_at; otherwise PostgreSQL defaults to NOW()
      ...(entry_date ? { created_at: new Date(entry_date).toISOString() } : {}),
      // CRITICAL: Retail no longer writes legacy tax columns (canonical-only mode)
      // Legacy columns (vat, nhil, getfund, covid) are NOT written for Retail sales
      // All tax data comes from tax_lines JSONB (source of truth)
      store_id: finalStoreId, // CRITICAL: Always set store_id - never leave it null
      // Canonical tax fields (source of truth for ledger posting and reporting)
      tax_lines: tax_lines || null, // JSONB array of tax line items from frontend
      tax_engine_code: taxesApplied ? finalTaxEngineCode : null,
      tax_engine_effective_from: taxesApplied ? effectiveDate : null,
      tax_jurisdiction: taxesApplied ? jurisdiction : null,
      // Customer reference (Phase 1 - identity only, no accounting impact)
      customer_id: customer_id || null,
      // Discount fields (Phase 1 - Advanced Discounts, immutable after posting)
      ...computedDiscountFields,
      // Layaway fields (Phase 2 - Layaway/Installments) - NOT IMPLEMENTED YET
      // is_layaway and deposit_amount are NOT included in sale insert
      // These columns don't exist in the database yet
    }
    
    // Debug logging - verify store_id is set
    console.log("Sale data before insert:", {
      store_id: saleData.store_id,
      finalStoreId: finalStoreId,
      business_id: saleData.business_id,
      amount: saleData.amount
    })

    // Only add subtotal if column exists (optional field)
    // Subtotal can be calculated from sale_items if needed
    // if (subtotal !== undefined && subtotal !== null) {
    //   saleData.subtotal = Number(subtotal)
    // }

    // Add payment breakdown fields if provided
    if (cash_amount !== undefined) {
      saleData.cash_amount = Number(cash_amount)
    }
    if (momo_amount !== undefined) {
      saleData.momo_amount = Number(momo_amount)
    }
    if (card_amount !== undefined) {
      saleData.card_amount = Number(card_amount)
    }
    if (cash_received !== undefined && cash_received !== null) {
      saleData.cash_received = Number(cash_received)
    }
    if (change_given !== undefined && change_given !== null) {
      saleData.change_given = Number(change_given)
    }
    // Foreign currency fields not set - FX not fully supported end-to-end
    // Exchange rate capture, ledger posting, and reporting for foreign currency are not implemented

    // Store payment lines as JSON if provided
    if (payments && Array.isArray(payments)) {
      saleData.payment_lines = JSON.stringify(payments)
    }

    // Try to insert sale with store_id and status, but handle gracefully if columns don't exist
    let sale
    let saleError: any = null

    const { data: saleDataResult, error: insertError } = await supabase
      .from("sales")
      .insert(saleData)
      .select()
      .single()

    sale = saleDataResult
    saleError = insertError

    // If error is about missing columns, check which ones
    // CRITICAL: NEVER remove store_id - it's required for multi-store support
    if (saleError && (saleError.message?.includes("status") || saleError.code === "42703")) {
      // Only retry if it's about 'status' column, NOT store_id
      // If store_id column doesn't exist, we MUST fail - cannot create sale without it
      if (saleError.message?.includes("store_id")) {
        console.error("CRITICAL: store_id column missing in sales table. Cannot create sale without store_id.")
        return NextResponse.json(
          { error: "Database error: store_id column is missing. Please run the multi-store migration." },
          { status: 500 }
        )
      }
      
      // Only retry without 'status' column if that's the issue
      if (saleError.message?.includes("status")) {
        console.warn("status column not found in sales table, retrying without it (store_id is preserved)")
        const saleDataFallback = { ...saleData }
        delete saleDataFallback.status
        // DO NOT delete store_id - it's critical!
        
        const { data: retrySale, error: retryError } = await supabase
          .from("sales")
          .insert(saleDataFallback)
          .select()
          .single()
        
        if (retryError) {
          return NextResponse.json(
            { error: retryError.message || "Failed to create sale" },
            { status: 500 }
          )
        }
        sale = retrySale
      }
    } else if (saleError) {
      return NextResponse.json(
        { error: saleError.message || "Failed to create sale" },
        { status: 500 }
      )
    }

    if (!sale) {
      return NextResponse.json(
        { error: "Failed to create sale" },
        { status: 500 }
      )
    }

    // Debug logging - verify store_id was saved
    const savedStoreId = (sale as any).store_id
    console.log("Sale created successfully:", {
      sale_id: sale.id,
      store_id_in_db: savedStoreId,
      store_id_expected: finalStoreId,
      store_id_match: savedStoreId === finalStoreId,
      amount: sale.amount,
      business_id: sale.business_id,
      user_id: sale.user_id
    })
    
    // CRITICAL: Warn if store_id is missing
    if (!savedStoreId) {
      console.error("WARNING: Sale was created but store_id is NULL in database!", {
        sale_id: sale.id,
        expected_store_id: finalStoreId,
        sale_data: sale
      })
    }

    /** Filled only after successful sale_items insert + stock mutations (forward path). */
    let stockCompensationPlan: StockCompensationEntry[] = []

    // Create sale items if provided
    // NOTE: Sale items must be created BEFORE ledger posting so COGS can be calculated
    if (sale_items && Array.isArray(sale_items) && sale_items.length > 0) {
      console.log("Creating sale items:", sale_items.length, sale_items)
      
      // First, fetch all product cost prices for COGS calculation
      const productIds = sale_items
        .map((item: any) => item.product_id)
        .filter((id: any) => id)
      const productCostMap: Record<string, number> = {}

      if (productIds.length > 0) {
        const { data: productsData } = await supabase
          .from("products")
          .select("id, cost_price")
          .in("id", productIds)

        if (productsData) {
          productsData.forEach((p) => {
            productCostMap[p.id] = p.cost_price ? Number(p.cost_price) : 0
          })
        }
      }

      // Fetch variant cost prices if any items have variants
      const variantIds = sale_items
        .map((item: any) => item.variant_id)
        .filter((id: any) => id)
      const variantCostMap: Record<string, number> = {}
      const storeAverageCostMap: Record<string, number> = {}

      if (variantIds.length > 0) {
        const { data: variantsData } = await supabase
          .from("products_variants")
          .select("id, cost_price")
          .in("id", variantIds)

        if (variantsData) {
          variantsData.forEach((v) => {
            variantCostMap[v.id] = v.cost_price ? Number(v.cost_price) : 0
          })
        }
      }

      // Primary retail COGS source: store-level AVCO on products_stock
      if (finalStoreId && productIds.length > 0) {
        const { data: storeStockCosts } = await supabase
          .from("products_stock")
          .select("product_id, variant_id, average_cost")
          .eq("store_id", finalStoreId)
          .in("product_id", productIds)

        if (storeStockCosts) {
          storeStockCosts.forEach((row) => {
            const key = `${row.product_id}::${row.variant_id ?? "null"}`
            storeAverageCostMap[key] = row.average_cost ? Number(row.average_cost) : 0
          })
        }
      }

      const itemsToInsert = sale_items.map((item: any) => {
        const productId = item.product_id || null
        const variantId = item.variant_id || null
        const quantity = Number(item.quantity || item.qty || 1)

        // COGS cost source priority:
        // 1) store-level products_stock.average_cost
        // 2) variant cost_price fallback
        // 3) product cost_price fallback
        // 4) zero as last resort (warn)
        const stockKey = `${productId}::${variantId ?? "null"}`
        const storeAverageCost = productId ? (storeAverageCostMap[stockKey] || 0) : 0
        const fallbackVariantCost = variantId ? (variantCostMap[variantId] || 0) : 0
        const fallbackProductCost = productId ? (productCostMap[productId] || 0) : 0
        const costPrice = storeAverageCost > 0
          ? storeAverageCost
          : (fallbackVariantCost > 0 ? fallbackVariantCost : fallbackProductCost)

        if (costPrice <= 0 && productId) {
          console.warn("[retail-cogs-cost-fallback-zero] using 0 cost for sale item", {
            sale_id: sale.id,
            store_id: finalStoreId,
            product_id: productId,
            variant_id: variantId,
          })
        }
        const cogs = costPrice * quantity

        // Find corresponding discount calculation result for this line item
        const lineIndex = sale_items.findIndex((si: any) => 
          si.product_id === productId && 
          (si.variant_id || null) === variantId
        )
        const lineDiscountResult = discountCalculation && lineIndex >= 0
          ? discountCalculation.lineItems[lineIndex]
          : null

        const itemData: any = {
          sale_id: sale.id,
          product_id: productId,
          name: item.product_name || item.name || "Unknown Product", // Database column is 'name', not 'product_name'
          price: Number(item.unit_price || item.price || 0), // Database column is 'price', not 'unit_price'
          qty: quantity, // Database column is 'qty', not 'quantity'
          store_id: finalStoreId, // CRITICAL: Every sale item inherits the sale's store_id
          // Discount fields (Phase 1 - Advanced Discounts)
          discount_type: item.discount_type || 'none',
          discount_value: item.discount_value ? Number(item.discount_value) : 0,
          discount_amount: lineDiscountResult?.line_discount_amount || 0,
        }

        // Only add variant_id if column exists (for backward compatibility)
        // This column was added in migration 023_product_variants.sql
        if (variantId) {
          itemData.variant_id = variantId
        }

        // Always add cost_price and cogs (required for profit calculations)
        // These columns were added in migration 021_cogs_tracking.sql
        // Set to 0 if not available (for backward compatibility)
        itemData.cost_price = costPrice || 0
        itemData.cogs = cogs || 0

        return itemData
      })

      console.log("Items to insert:", itemsToInsert)

      // Try to insert with store_id, but handle gracefully if column doesn't exist
      let insertedItems: any[] | null = null
      let itemsError: any = null
      
      const insertResult = await supabase
        .from("sale_items")
        .insert(itemsToInsert)
        .select()
      
      insertedItems = insertResult.data
      itemsError = insertResult.error
      
      // If error is about missing store_id column, retry without it
      // (sale_items can inherit store_id from parent sale via sale_id)
      if (itemsError && (itemsError.message?.includes("store_id") || itemsError.code === "42703")) {
        console.warn("sale_items.store_id column not found, inserting without it (items inherit store_id from sale)")
        const itemsWithoutStoreId = itemsToInsert.map((item: any) => {
          const { store_id, ...rest } = item
          return rest
        })
        
        const retryResult = await supabase
          .from("sale_items")
          .insert(itemsWithoutStoreId)
          .select()
        
        if (!retryResult.error) {
          insertedItems = retryResult.data
          itemsError = null
        }
      }

      if (itemsError) {
        console.error("Error creating sale items:", itemsError)
        await supabase.from("sales").delete().eq("id", sale.id)
        return NextResponse.json(
          {
            error: `Failed to save sale line items: ${itemsError.message}`,
            code: "SALE_ITEMS_INSERT_FAILED",
          },
          { status: 500 }
        )
      }

      console.log("Successfully inserted sale items:", insertedItems?.length || 0)

      // Validate and deduct stock for each item, and store COGS
      // Get store_id for stock operations (used for all items)
      const storeIdForStock = finalStoreId
      
      for (const item of sale_items) {
        if (!item.product_id) continue

        const variantId = item.variant_id || null
        const quantitySold = Math.floor(Number(item.quantity || 1))

        // If item has a variant, deduct from variant stock (per store)
        if (variantId) {
          // Check products_stock first (per-store inventory)
          let currentStock = 0
          let stockRecordId: string | null = null

          if (storeIdForStock) {
            const { data: storeStock, error: variantStockError } = await supabase
              .from("products_stock")
              .select("id, stock_quantity, stock")
              .eq("product_id", item.product_id)
              .eq("variant_id", variantId)
              .eq("store_id", storeIdForStock)
              .maybeSingle()

            if (variantStockError) {
              console.error(`Error fetching variant stock for product ${item.product_id}, variant ${variantId}, store ${storeIdForStock}:`, variantStockError)
              const rolled = await abortRetailSaleWithCompensation({
                supabase,
                saleId: sale.id,
                businessId: business_id,
                plan: stockCompensationPlan,
              })
              if (!rolled.ok) {
                return NextResponse.json(
                  { error: `Rollback failed: ${rolled.message}`, code: "ROLLBACK_FAILED" },
                  { status: 500 }
                )
              }
              return NextResponse.json(
                {
                  error: `Stock lookup failed. Sale not completed. Unable to verify stock for variant.`,
                  details: variantStockError.message || String(variantStockError),
                },
                { status: 500 }
              )
            }

            if (storeStock) {
              currentStock = Math.floor(
                storeStock.stock_quantity !== null && storeStock.stock_quantity !== undefined
                  ? Number(storeStock.stock_quantity)
                  : storeStock.stock !== null && storeStock.stock !== undefined
                  ? Number(storeStock.stock)
                  : 0
              )
              stockRecordId = storeStock.id
            }
          } else {
            // Fallback to variant stock if no store (backward compatibility)
            const { data: variant } = await supabase
              .from("products_variants")
              .select("stock_quantity, stock, variant_name")
              .eq("id", variantId)
              .single()

            if (variant) {
              currentStock = Math.floor(
                variant.stock_quantity !== null && variant.stock_quantity !== undefined
                  ? Number(variant.stock_quantity)
                  : variant.stock !== null && variant.stock !== undefined
                  ? Number(variant.stock)
                  : 0
              )
            }
          }

          // Validate stock availability
          if (currentStock < quantitySold) {
            const rolled = await abortRetailSaleWithCompensation({
              supabase,
              saleId: sale.id,
              businessId: business_id,
              plan: stockCompensationPlan,
            })
            if (!rolled.ok) {
              return NextResponse.json(
                { error: `Rollback failed: ${rolled.message}`, code: "ROLLBACK_FAILED" },
                { status: 500 }
              )
            }
            return NextResponse.json(
              {
                error: `Insufficient stock for variant. Available: ${currentStock}, Requested: ${quantitySold}`,
              },
              { status: 400 }
            )
          }

          const newStock = Math.floor(currentStock - quantitySold)

          // ALWAYS update products_stock - never modify products_variants.stock
          let stockUpdateError: any = null
          let updatedVariantStockRecordId: string | null = stockRecordId
          const variantHadStockRowBeforeMutation = !!stockRecordId

          if (storeIdForStock && stockRecordId) {
            // Update existing products_stock record
            const { error: updateError } = await supabase
              .from("products_stock")
              .update({
                stock: newStock,
                stock_quantity: newStock,
              })
              .eq("id", stockRecordId)
            
            stockUpdateError = updateError
          } else if (storeIdForStock && !stockRecordId) {
            // Create new products_stock record if it doesn't exist
            const { data: insertedStock, error: insertError } = await supabase.from("products_stock").insert({
              product_id: item.product_id,
              variant_id: variantId,
              store_id: storeIdForStock,
              stock: newStock,
              stock_quantity: newStock,
            }).select("id").single()
            
            stockUpdateError = insertError
            if (insertedStock) {
              updatedVariantStockRecordId = insertedStock.id
            }
          } else {
            // This should never happen - storeIdForStock must be set
            // But if it does, fail the sale rather than updating variant stock
            const rolled = await abortRetailSaleWithCompensation({
              supabase,
              saleId: sale.id,
              businessId: business_id,
              plan: stockCompensationPlan,
            })
            if (!rolled.ok) {
              return NextResponse.json(
                { error: `Rollback failed: ${rolled.message}`, code: "ROLLBACK_FAILED" },
                { status: 500 }
              )
            }
            return NextResponse.json(
              { error: `Cannot deduct stock: No store_id available for variant ${variantId}. Please select a store first.` },
              { status: 400 }
            )
          }

          // If stock update failed, rollback sale and fail
          if (stockUpdateError) {
            const rolled = await abortRetailSaleWithCompensation({
              supabase,
              saleId: sale.id,
              businessId: business_id,
              plan: stockCompensationPlan,
            })
            if (!rolled.ok) {
              return NextResponse.json(
                { error: `Rollback failed: ${rolled.message}`, code: "ROLLBACK_FAILED" },
                { status: 500 }
              )
            }
            return NextResponse.json(
              { error: `Stock update failed. Sale not completed. Product: ${item.product_name || "Variant"}` },
              { status: 500 }
            )
          }

          // Log stock movement - this must also succeed or sale fails
          const variantMovementData: any = {
            business_id,
            product_id: item.product_id,
            quantity_change: -quantitySold,
            type: "sale",
            user_id,
            related_sale_id: sale.id,
            note: `Variant sale: ${item.product_name || "Product"} x${quantitySold}`,
          }

          // Add store_id if provided (column may not exist if migration hasn't run)
          if (storeIdForStock) {
            variantMovementData.store_id = storeIdForStock
          }

          const serviceRoleClient = getServiceRoleClient()
          const { error: movementError } = await serviceRoleClient
            .from("stock_movements")
            .insert(variantMovementData)

          if (movementError) {
            console.error("Failed to create stock movement for variant:", {
              error: movementError,
              movementData: variantMovementData,
              variantId: variantId,
              productId: item.product_id,
              storeId: storeIdForStock
            })
            const extraEntry: StockCompensationEntry | null = updatedVariantStockRecordId
              ? {
                  products_stock_id: updatedVariantStockRecordId,
                  prior_stock: currentStock,
                  created_during_sale: !variantHadStockRowBeforeMutation,
                }
              : null
            const rolled = await abortRetailSaleWithCompensation({
              supabase,
              saleId: sale.id,
              businessId: business_id,
              plan: stockCompensationPlan,
              extraStockEntry: extraEntry,
            })
            if (!rolled.ok) {
              return NextResponse.json(
                { error: `Rollback failed: ${rolled.message}`, code: "ROLLBACK_FAILED" },
                { status: 500 }
              )
            }
            return NextResponse.json(
              {
                error: `Stock update failed. Sale not completed. Unable to record stock movement.`,
                details: movementError.message || String(movementError),
                code: movementError.code,
              },
              { status: 500 }
            )
          }

          if (updatedVariantStockRecordId) {
            stockCompensationPlan.push({
              products_stock_id: updatedVariantStockRecordId,
              prior_stock: currentStock,
              created_during_sale: !variantHadStockRowBeforeMutation,
            })
          }

          continue // Skip product stock deduction for variants
        }

        // No variant - deduct from product stock (per-store if store_id exists)
        // storeIdForStock is already defined above (reused from line 287)
        let currentStock = 0
        let stockRecordId: string | null = null

        // Check products_stock first (per-store inventory)
        // CRITICAL: Must use storeIdForStock (finalStoreId) to ensure correct store
        if (storeIdForStock) {
          console.log(`Checking stock for product ${item.product_id} in store ${storeIdForStock}, quantity requested: ${quantitySold}`)
          const { data: storeStock, error: storeStockError } = await supabase
            .from("products_stock")
            .select("id, stock_quantity, stock")
            .eq("product_id", item.product_id)
            .is("variant_id", null)
            .eq("store_id", storeIdForStock)
            .maybeSingle()

          if (storeStockError) {
            console.error(`Error fetching products_stock for product ${item.product_id}, store ${storeIdForStock}:`, storeStockError)
            const rolled = await abortRetailSaleWithCompensation({
              supabase,
              saleId: sale.id,
              businessId: business_id,
              plan: stockCompensationPlan,
            })
            if (!rolled.ok) {
              return NextResponse.json(
                { error: `Rollback failed: ${rolled.message}`, code: "ROLLBACK_FAILED" },
                { status: 500 }
              )
            }
            return NextResponse.json(
              {
                error: `Stock lookup failed. Sale not completed. Unable to verify stock for product.`,
                details: storeStockError.message || String(storeStockError),
              },
              { status: 500 }
            )
          }

          if (storeStock) {
            currentStock = Math.floor(
              storeStock.stock_quantity !== null && storeStock.stock_quantity !== undefined
                ? Number(storeStock.stock_quantity)
                : storeStock.stock !== null && storeStock.stock !== undefined
                ? Number(storeStock.stock)
                : 0
            )
            stockRecordId = storeStock.id
            console.log(`Found products_stock record for product ${item.product_id}, store ${storeIdForStock}: stock=${currentStock}`)
          } else {
            console.log(`No products_stock record found for product ${item.product_id}, store ${storeIdForStock} - will create new record`)
          }
        }

        // Get product to check track_stock flag and cost_price
        const { data: product, error: productError } = await supabase
          .from("products")
          .select("track_stock, stock_quantity, stock, name, cost_price")
          .eq("id", item.product_id)
          .single()

        if (productError || !product) {
          console.error(`Error fetching product ${item.product_id}:`, productError)
          continue
        }

        // Only validate/deduct stock if track_stock is true
        if (product.track_stock !== false) {
          // Use store stock if available, otherwise fall back to product stock
          if (currentStock === 0 && !storeIdForStock) {
            currentStock = Math.floor(
              product.stock_quantity !== null && product.stock_quantity !== undefined
                ? Number(product.stock_quantity)
                : product.stock !== null && product.stock !== undefined
                ? Number(product.stock)
                : 0
            )
          }
          const quantitySold = Math.floor(Number(item.quantity || 1))

          // Validate stock availability - prevent sale if out of stock
          if (currentStock < quantitySold) {
            const rolled = await abortRetailSaleWithCompensation({
              supabase,
              saleId: sale.id,
              businessId: business_id,
              plan: stockCompensationPlan,
            })
            if (!rolled.ok) {
              return NextResponse.json(
                { error: `Rollback failed: ${rolled.message}`, code: "ROLLBACK_FAILED" },
                { status: 500 }
              )
            }
            return NextResponse.json(
              {
                error: `Insufficient stock for "${product.name || item.product_name}". Available: ${currentStock}, Requested: ${quantitySold}`,
              },
              { status: 400 }
            )
          }

          const newStock = Math.floor(currentStock - quantitySold) // Will never be negative due to validation above

          console.log(`Deducting stock for product ${item.product_id}: current=${currentStock}, quantity=${quantitySold}, new=${newStock}, store=${storeIdForStock}`)

          // ALWAYS update products_stock - never modify products.stock
          let stockUpdateError: any = null
          let updatedStockRecordId: string | null = stockRecordId
          const simpleHadStockRowBeforeMutation = !!stockRecordId

          if (storeIdForStock && stockRecordId) {
            // Update existing products_stock record
            const { error: updateError } = await supabase
              .from("products_stock")
              .update({
                stock: newStock,
                stock_quantity: newStock,
              })
              .eq("id", stockRecordId)
            
            stockUpdateError = updateError
          } else if (storeIdForStock && !stockRecordId) {
            // Create new products_stock record if it doesn't exist
            // If currentStock is 0, newStock will be negative - this is OK for initial setup
            // The stock will be adjusted later when stock is added
            const { data: insertedStock, error: insertError } = await supabase.from("products_stock").insert({
              product_id: item.product_id,
              variant_id: null,
              store_id: storeIdForStock,
              stock: newStock,
              stock_quantity: newStock,
            }).select("id").single()
            
            stockUpdateError = insertError
            if (insertedStock) {
              updatedStockRecordId = insertedStock.id
            }
          } else {
            // This should never happen - storeIdForStock must be set
            // But if it does, fail the sale rather than updating products.stock
            const rolled = await abortRetailSaleWithCompensation({
              supabase,
              saleId: sale.id,
              businessId: business_id,
              plan: stockCompensationPlan,
            })
            if (!rolled.ok) {
              return NextResponse.json(
                { error: `Rollback failed: ${rolled.message}`, code: "ROLLBACK_FAILED" },
                { status: 500 }
              )
            }
            return NextResponse.json(
              { error: `Cannot deduct stock: No store_id available for product ${item.product_id}. Please select a store first.` },
              { status: 400 }
            )
          }

          // If stock update failed, rollback sale and fail
          if (stockUpdateError) {
            const rolled = await abortRetailSaleWithCompensation({
              supabase,
              saleId: sale.id,
              businessId: business_id,
              plan: stockCompensationPlan,
            })
            if (!rolled.ok) {
              return NextResponse.json(
                { error: `Rollback failed: ${rolled.message}`, code: "ROLLBACK_FAILED" },
                { status: 500 }
              )
            }
            return NextResponse.json(
              { error: `Stock update failed. Sale not completed. Product: ${product.name || item.product_name || "Product"}` },
              { status: 500 }
            )
          }

          // Create stock movement record - this must also succeed or sale fails
          const stockMovementData: any = {
            business_id: business_id,
            product_id: item.product_id,
            quantity_change: -quantitySold, // Negative for sale
            type: "sale",
            user_id: user_id,
            related_sale_id: sale.id,
            note: `Sale: ${item.product_name || product.name || "Product"} x${quantitySold}`,
          }

          // Add store_id if provided (column may not exist if migration hasn't run)
          if (storeIdForStock) {
            stockMovementData.store_id = storeIdForStock
          }

          const serviceRoleClient = getServiceRoleClient()
          const { error: movementError } = await serviceRoleClient
            .from("stock_movements")
            .insert(stockMovementData)

          if (movementError) {
            console.error("Failed to create stock movement for product:", {
              error: movementError,
              movementData: stockMovementData,
              productId: item.product_id,
              storeId: storeIdForStock,
              quantitySold: quantitySold
            })
            const extraEntrySimple: StockCompensationEntry | null = updatedStockRecordId
              ? {
                  products_stock_id: updatedStockRecordId,
                  prior_stock: currentStock,
                  created_during_sale: !simpleHadStockRowBeforeMutation,
                }
              : null
            const rolled = await abortRetailSaleWithCompensation({
              supabase,
              saleId: sale.id,
              businessId: business_id,
              plan: stockCompensationPlan,
              extraStockEntry: extraEntrySimple,
            })
            if (!rolled.ok) {
              return NextResponse.json(
                { error: `Rollback failed: ${rolled.message}`, code: "ROLLBACK_FAILED" },
                { status: 500 }
              )
            }
            return NextResponse.json(
              {
                error: `Stock update failed. Sale not completed. Unable to record stock movement.`,
                details: movementError.message || String(movementError),
                code: movementError.code,
              },
              { status: 500 }
            )
          }

          if (updatedStockRecordId) {
            stockCompensationPlan.push({
              products_stock_id: updatedStockRecordId,
              prior_stock: currentStock,
              created_during_sale: !simpleHadStockRowBeforeMutation,
            })
          }
        }
      }
    } else {
      console.warn("No sale_items provided in request body")
    }

    // Layaway plan creation removed - layaway not implemented yet
    // All sales are normal (full payment) sales

    // PHASE 1: AUTOMATIC SALES POSTING - Post sale to ledger atomically
    // Every sale MUST create a journal entry. Failure to post blocks sale creation.
    // NOTE: This happens AFTER sale_items creation so COGS can be calculated from sale_items
    // RETAIL FIX: Pass business owner as system accountant for authorization
    // All sales are normal (full payment) - layaway not implemented yet
    try {
      const { data: journalEntryId, error: ledgerError } = await supabase.rpc(
        "post_sale_to_ledger",
        {
          p_sale_id: sale.id,
          p_entry_type: null,
          p_backfill_reason: null,
          p_backfill_actor: null,
          p_posted_by_accountant_id: businessRow.owner_id, // System accountant: business owner
        }
      )

      if (ledgerError) {
        console.error("Failed to post sale to ledger:", ledgerError)
        const rolled = await compensateFailedRetailSale({
          supabase,
          saleId: sale.id,
          businessId: business_id,
          stockEntries: stockCompensationPlan,
        })
        if (!rolled.ok) {
          return NextResponse.json(
            {
              error: `Ledger posting failed and rollback could not complete: ${rolled.message}`,
              code: "ROLLBACK_FAILED",
            },
            { status: 500 }
          )
        }
        return NextResponse.json(
          {
            error: `Failed to post sale to ledger: ${ledgerError.message || "Ledger posting failed"}`,
            code: "LEDGER_POST_FAILED_ROLLED_BACK",
            details: "Sale creation was rolled back due to ledger posting failure",
          },
          { status: 500 }
        )
      }

      if (!journalEntryId) {
        console.error("Ledger posting returned no journal entry ID")
        const rolled = await compensateFailedRetailSale({
          supabase,
          saleId: sale.id,
          businessId: business_id,
          stockEntries: stockCompensationPlan,
        })
        if (!rolled.ok) {
          return NextResponse.json(
            {
              error: `Ledger posting failed and rollback could not complete: ${rolled.message}`,
              code: "ROLLBACK_FAILED",
            },
            { status: 500 }
          )
        }
        return NextResponse.json(
          {
            error: "Failed to post sale to ledger: No journal entry was created",
            code: "LEDGER_POST_FAILED_ROLLED_BACK",
            details: "Sale creation was rolled back",
          },
          { status: 500 }
        )
      }

      console.log("Sale posted to ledger successfully:", {
        sale_id: sale.id,
        journal_entry_id: journalEntryId,
      })
    } catch (ledgerException: any) {
      console.error("Exception while posting sale to ledger:", ledgerException)
      const rolled = await compensateFailedRetailSale({
        supabase,
        saleId: sale.id,
        businessId: business_id,
        stockEntries: stockCompensationPlan,
      })
      if (!rolled.ok) {
        return NextResponse.json(
          {
            error: `Ledger posting failed and rollback could not complete: ${rolled.message}`,
            code: "ROLLBACK_FAILED",
          },
          { status: 500 }
        )
      }
      return NextResponse.json(
        {
          error: `Failed to post sale to ledger: ${ledgerException.message || "Unexpected error"}`,
          code: "LEDGER_POST_FAILED_ROLLED_BACK",
          details: "Sale creation was rolled back due to ledger posting exception",
        },
        { status: 500 }
      )
    }

    // PHASE 3: RECONCILIATION VALIDATION
    // Enforce that operational data matches ledger data
    // This ensures 100% reconciliation: no operational-only financial movements
    try {
      const { data: isReconciled, error: reconciliationError } = await supabase.rpc(
        "validate_sale_reconciliation",
        {
          p_sale_id: sale.id,
        }
      )

      if (reconciliationError) {
        console.error("Sale reconciliation validation failed:", reconciliationError)
        const rolled = await compensateFailedRetailSale({
          supabase,
          saleId: sale.id,
          businessId: business_id,
          stockEntries: stockCompensationPlan,
        })
        if (!rolled.ok) {
          return NextResponse.json(
            {
              error: `Reconciliation failed and rollback could not complete: ${rolled.message}`,
              code: "ROLLBACK_FAILED",
            },
            { status: 500 }
          )
        }
        return NextResponse.json(
          {
            error: `Sale reconciliation failed: ${reconciliationError.message || "Operational data does not match ledger data"}`,
            details: "Sale creation was rolled back due to reconciliation failure. This indicates a system error.",
            code: "RECONCILIATION_FAILED_ROLLED_BACK",
          },
          { status: 500 }
        )
      }

      if (isReconciled !== true) {
        console.error("Sale reconciliation returned false (unexpected)")
        const rolled = await compensateFailedRetailSale({
          supabase,
          saleId: sale.id,
          businessId: business_id,
          stockEntries: stockCompensationPlan,
        })
        if (!rolled.ok) {
          return NextResponse.json(
            {
              error: `Reconciliation failed and rollback could not complete: ${rolled.message}`,
              code: "ROLLBACK_FAILED",
            },
            { status: 500 }
          )
        }
        return NextResponse.json(
          {
            error: "Sale reconciliation validation failed: Operational data does not match ledger data",
            details: "Sale creation was rolled back due to reconciliation failure",
            code: "RECONCILIATION_FAILED_ROLLED_BACK",
          },
          { status: 500 }
        )
      }

      console.log("Sale reconciliation validated successfully:", {
        sale_id: sale.id,
        reconciled: isReconciled,
      })
    } catch (reconciliationException: any) {
      console.error("Exception during sale reconciliation:", reconciliationException)
      const rolled = await compensateFailedRetailSale({
        supabase,
        saleId: sale.id,
        businessId: business_id,
        stockEntries: stockCompensationPlan,
      })
      if (!rolled.ok) {
        return NextResponse.json(
          {
            error: `Reconciliation failed and rollback could not complete: ${rolled.message}`,
            code: "ROLLBACK_FAILED",
          },
          { status: 500 }
        )
      }
      return NextResponse.json(
        {
          error: `Sale reconciliation failed: ${reconciliationException.message || "Unexpected error during reconciliation"}`,
          details: "Sale creation was rolled back due to reconciliation exception",
          code: "RECONCILIATION_FAILED_ROLLED_BACK",
        },
        { status: 500 }
      )
    }

    // Register session cash balance is calculated from sales when closing
    // Cash received increases register balance, change given decreases it
    // This is handled in the register closing logic

    if (retailMomoRef && retailMomoTxnId) {
      const { data: attached, error: attachErr } = await supabase
        .from("payment_provider_transactions")
        .update({ sale_id: sale.id })
        .eq("id", retailMomoTxnId)
        .is("sale_id", null)
        .select("id")
        .maybeSingle()

      if (attachErr) {
        console.error("[retail-momo-sandbox] attach sale_id failed", attachErr)
      }

      if (!attached?.id) {
        const { data: linked } = await supabase
          .from("payment_provider_transactions")
          .select("sale_id")
          .eq("id", retailMomoTxnId)
          .maybeSingle()

        const existingSaleId = (linked as { sale_id?: string | null } | null)?.sale_id
        if (existingSaleId) {
          console.warn("[retail-momo-sandbox] concurrent finalize — compensating duplicate sale", {
            duplicate_sale_id: sale.id,
            kept_sale_id: existingSaleId,
            reference: retailMomoRef,
          })
          const rolled = await compensateFailedRetailSale({
            supabase,
            saleId: sale.id,
            businessId: business_id,
            stockEntries: stockCompensationPlan,
          })
          if (!rolled.ok) {
            return NextResponse.json(
              {
                error: "Duplicate finalize rollback failed — contact support",
                code: "MOMO_DUPLICATE_FINALIZE_ROLLBACK_FAILED",
                details: rolled.message,
              },
              { status: 500 },
            )
          }
          return NextResponse.json({
            success: true,
            sale_id: existingSaleId,
            message: "Sale already recorded for this payment",
            idempotent: true,
          })
        }

        console.error("[retail-momo-sandbox] attach race without linked sale_id", {
          sale_id: sale.id,
          reference: retailMomoRef,
        })
        const rolledOrphan = await compensateFailedRetailSale({
          supabase,
          saleId: sale.id,
          businessId: business_id,
          stockEntries: stockCompensationPlan,
        })
        if (!rolledOrphan.ok) {
          return NextResponse.json(
            {
              error: "Could not link MoMo payment to sale; rollback failed",
              code: "MOMO_LINK_FAILED",
              details: rolledOrphan.message,
            },
            { status: 500 },
          )
        }
        return NextResponse.json(
          { error: "Could not finalize MoMo payment linkage", code: "MOMO_LINK_FAILED" },
          { status: 500 },
        )
      }

      console.log("[retail-momo-sandbox] sale linked to payment attempt", {
        reference: retailMomoRef,
        sale_id: sale.id,
      })
    }

    return NextResponse.json({
      success: true,
      sale_id: sale.id,
      message: "Sale created successfully",
    })
  } catch (error: any) {
    console.error("Error in runRetailSaleCreationEngine:", error)
    console.error("Error stack:", error.stack)
    return NextResponse.json(
      {
        error: error.message || "Internal server error",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
      { status: 500 }
    )
  }
}
