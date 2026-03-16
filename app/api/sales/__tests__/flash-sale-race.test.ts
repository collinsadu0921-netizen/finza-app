/**
 * Flash Sale Race Condition Stress Test
 *
 * Verifies the "No Silent Failure" rule under extreme concurrency:
 * - Exactly 5 sales succeed (200 OK)
 * - Exactly 5 sales fail with 400/409 (Out of Stock or Concurrency Error)
 * - Trial Balance total = 0 (Debits = Credits)
 * - No partial journals (every Sale has a Ledger entry)
 * - products_stock = 0 (never negative)
 *
 * Prerequisites:
 * - Next.js app running (e.g. npm run dev) with SUPABASE_SERVICE_ROLE_KEY set
 * - Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TEST_USER_ID
 * - Optional: BASE_URL (default http://localhost:3000)
 *
 * Run: npx vitest run --testPathPattern=flash-sale-race
 */

import { describe, it, beforeAll, expect } from "vitest"
import { createClient } from "@supabase/supabase-js"

const BASE_URL = process.env.BASE_URL || "http://localhost:3000"
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const TEST_USER_ID = process.env.TEST_USER_ID

let businessId: string
let userId: string
let storeId: string
let registerId: string
let productId: string
let periodId: string

describe("Flash Sale Race Condition - No Silent Failure", () => {
  beforeAll(async () => {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      throw new Error(
        "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required"
      )
    }
    if (!TEST_USER_ID) {
      throw new Error("TEST_USER_ID is required (use an existing user UUID)")
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    userId = TEST_USER_ID
    const today = new Date().toISOString().split("T")[0]

    // 1) Create business
    const { data: biz, error: bizErr } = await supabase
      .from("businesses")
      .insert({
        name: `Flash Sale Race Test ${Date.now()}`,
        owner_id: userId,
        address_country: "GH",
      })
      .select("id")
      .single()

    if (bizErr || !biz) {
      throw new Error(`Failed to create business: ${bizErr?.message || "unknown"}`)
    }
    businessId = biz.id

    // 2) System accounts (required for post_sale_to_ledger)
    await supabase.rpc("create_system_accounts", { p_business_id: businessId })

    // 3) Link user to business (owner skips store enforcement)
    await supabase.from("business_users").insert({
      user_id: userId,
      business_id: businessId,
      role: "owner",
    })

    // 4) Store
    const { data: store, error: storeErr } = await supabase
      .from("stores")
      .insert({ business_id: businessId, name: "Flash Sale Test Store" })
      .select("id")
      .single()

    if (storeErr || !store) {
      throw new Error(`Failed to create store: ${storeErr?.message || "unknown"}`)
    }
    storeId = store.id

    // 5) Register (must belong to store)
    const { data: reg, error: regErr } = await supabase
      .from("registers")
      .insert({
        business_id: businessId,
        store_id: storeId,
        name: "Flash Sale Test Register",
      })
      .select("id")
      .single()

    if (regErr || !reg) {
      throw new Error(`Failed to create register: ${regErr?.message || "unknown"}`)
    }
    registerId = reg.id

    // 6) Product (track_stock true, cost for COGS)
    const { data: prod, error: prodErr } = await supabase
      .from("products")
      .insert({
        business_id: businessId,
        name: "Flash Sale Product",
        price: 10,
        cost_price: 5,
        track_stock: true,
      })
      .select("id")
      .single()

    if (prodErr || !prod) {
      throw new Error(`Failed to create product: ${prodErr?.message || "unknown"}`)
    }
    productId = prod.id

    // 7) products_stock: exactly 5 units
    const { error: psErr } = await supabase.from("products_stock").insert({
      product_id: productId,
      store_id: storeId,
      variant_id: null,
      stock: 5,
      stock_quantity: 5,
    })

    if (psErr) {
      // May exist from prior run; upsert/update
      const { data: existing } = await supabase
        .from("products_stock")
        .select("id")
        .eq("product_id", productId)
        .eq("store_id", storeId)
        .is("variant_id", null)
        .maybeSingle()
      if (existing) {
        await supabase
          .from("products_stock")
          .update({ stock: 5, stock_quantity: 5 })
          .eq("id", existing.id)
      } else {
        throw new Error(`Failed to create products_stock: ${psErr.message}`)
      }
    }

    // 8) Accounting period OPEN (required by post_sale_to_ledger)
    const { data: periodData, error: periodErr } = await supabase.rpc(
      "ensure_accounting_period",
      { p_business_id: businessId, p_date: today }
    )

    const period = Array.isArray(periodData) && periodData.length
      ? periodData[0]
      : periodData

    if (periodErr || !period?.id) {
      throw new Error(`Failed to ensure accounting period: ${periodErr?.message || "no id"}`)
    }
    periodId = period.id

    if (period?.status && period.status !== "open") {
      await supabase
        .from("accounting_periods")
        .update({ status: "open" })
        .eq("id", periodId)
    }
  })

  it("Flash Sale Collision: 10 simultaneous Complete Sale requests, 5 OK / 5 Out of Stock, ledger balanced, no partial journals, stock = 0", async () => {
    const baseUrl = BASE_URL.replace(/\/$/, "")
    const url = `${baseUrl}/api/sales/create`

    const payload = {
      business_id: businessId,
      user_id: userId,
      store_id: storeId,
      active_store_id: storeId,
      register_id: registerId,
      amount: 10,
      payments: [{ method: "cash", amount: 10 }],
      sale_items: [
        {
          product_id: productId,
          product_name: "Flash Sale Product",
          quantity: 1,
          unit_price: 10,
        },
      ],
    }

    // Fire 10 requests at the same tick (best-effort same millisecond)
    const promises = Array.from({ length: 10 }, () =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    )

    const responses = await Promise.all(promises)

    const ok = responses.filter((r) => r.status === 200)
    const fail = responses.filter((r) => r.status === 400 || r.status === 409)
    const other = responses.filter((r) => r.status !== 200 && r.status !== 400 && r.status !== 409)

    // --- Success criteria ---
    expect(ok.length, "Exactly 5 sales must return 200 OK").toBe(5)
    expect(fail.length, "Exactly 5 sales must return 400 or 409 (Out of Stock / Concurrency)").toBe(5)
    if (other.length > 0) {
      const bodies = await Promise.all(other.map((r) => r.text()))
      throw new Error(`Unexpected statuses: ${other.map((r) => r.status).join(", ")}. Bodies: ${bodies.join("; ")}`)
    }

    // --- Ledger: Trial Balance total = 0 (debits = credits) ---
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!)
    const { data: tbRows, error: tbErr } = await supabase.rpc("get_trial_balance_from_snapshot", {
      p_period_id: periodId,
    })

    if (tbErr) {
      throw new Error(`Trial balance RPC failed: ${tbErr.message}`)
    }

    const sumDebits = (tbRows || []).reduce((s: number, r: any) => s + Number(r.debit_total || 0), 0)
    const sumCredits = (tbRows || []).reduce((s: number, r: any) => s + Number(r.credit_total || 0), 0)
    const diff = Math.abs(sumDebits - sumCredits)
    expect(diff, "Trial Balance: total debits must equal total credits (difference < 0.01)").toBeLessThan(0.01)

    // --- Integrity: No partial journals (Sale without Ledger) ---
    const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const { data: sales } = await supabase
      .from("sales")
      .select("id")
      .eq("business_id", businessId)
      .gte("created_at", since)

    const saleIds = (sales || []).map((s) => s.id)
    const { data: jes } = await supabase
      .from("journal_entries")
      .select("reference_id")
      .eq("reference_type", "sale")
      .in("reference_id", saleIds)

    const linkedIds = new Set((jes || []).map((j) => j.reference_id))
    const partial = saleIds.filter((id) => !linkedIds.has(id))
    expect(partial.length, "No Sale must exist without a journal entry (no partial journals)").toBe(0)

    // --- Stock: products_stock = 0 (never -5) ---
    const { data: ps } = await supabase
      .from("products_stock")
      .select("stock, stock_quantity")
      .eq("product_id", productId)
      .eq("store_id", storeId)
      .is("variant_id", null)
      .maybeSingle()

    expect(ps, "products_stock row must exist").toBeDefined()
    const stockVal = ps?.stock_quantity ?? ps?.stock ?? null
    expect(stockVal, "Final products_stock must be exactly 0, not negative").toBe(0)

    // Log IDs for use in FLASH_SALE_RACE_DIAGNOSTIC.sql
    console.log("Diagnostic IDs for FLASH_SALE_RACE_DIAGNOSTIC.sql:", {
      business_id: businessId,
      product_id: productId,
      store_id: storeId,
    })
  })
})
