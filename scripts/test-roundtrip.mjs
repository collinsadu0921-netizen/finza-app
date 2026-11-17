import pg from "pg"

const client = new pg.Client({ connectionString: "postgresql://postgres:finza_test_only@localhost:55439/finza" })
await client.connect()
const q = (t, p) => client.query(t, p)

const biz = "11111111-1111-1111-1111-111111111111"
const owner = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
const cust = "22222222-2222-2222-2222-222222222222"

// seed (idempotent)
await q(`ALTER TABLE IF EXISTS invoices DISABLE TRIGGER trigger_auto_post_invoice`)
await q(`ALTER TABLE IF EXISTS bills DISABLE TRIGGER trigger_auto_post_bill`)
await q(`ALTER TABLE IF EXISTS expenses DISABLE TRIGGER trigger_auto_post_expense`)

await q(`INSERT INTO auth.users (id, instance_id, email, is_sso_user, is_anonymous) VALUES ($1,'00000000-0000-0000-0000-000000000000','owner@test.local',false,false) ON CONFLICT (id) DO NOTHING`, [owner])
await q(`INSERT INTO users (id, email) VALUES ($1,'owner@test.local') ON CONFLICT (id) DO NOTHING`, [owner])
await q(`INSERT INTO businesses (id, owner_id, name, timezone, cit_rate_code, vat_scheme, service_subscription_tier, business_type, billing_exempt, trial_contact_consent, address_country, default_currency, accounting_start_date) VALUES ($1,$2,'T','Africa/Accra','standard_25','standard','business','limited_company',true,false,'GH','GHS','2026-01-01') ON CONFLICT (id) DO UPDATE SET owner_id=EXCLUDED.owner_id`, [biz, owner])
await q(`INSERT INTO customers (id, business_id, name) VALUES ($1,$2,'C') ON CONFLICT (id) DO NOTHING`, [cust, biz])
for (const [code, name, type] of [["1100","AR","asset"],["4000","Revenue","revenue"],["2100","VAT","liability"],["2110","NHIL","liability"],["2120","GETFund","liability"],["1010","Bank","asset"],["2000","AP","liability"],["5100","Operating","expense"],["5200","Bills","expense"]]) {
  await q(`INSERT INTO chart_of_accounts (business_id, account_code, account_name, account_type, is_active) VALUES ($1,$2,$3,$4,true) ON CONFLICT DO NOTHING`, [biz, code, name, type])
  await q(`INSERT INTO accounts (business_id, code, name, type, is_system) VALUES ($1,$2,$3,$4,true) ON CONFLICT DO NOTHING`, [biz, code, name, type === "revenue" ? "income" : type])
}
for (const [k, code] of [["AR","1100"],["CASH","1010"],["BANK","1010"],["AP","2000"]]) {
  await q(`INSERT INTO chart_of_accounts_control_map (business_id, control_key, account_code) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [biz, k, code])
}

// expected values: 20% flat (post-2026)
const EXCL_NET = 70000, EXCL_TAX = 14000, EXCL_GROSS = 84000
const INCL_GROSS = 70000, INCL_NET = Math.round((70000 / 1.2) * 100) / 100, INCL_TAX = Math.round((70000 - INCL_NET) * 100) / 100

const results = {}

// ---- INVOICE round-trip ----
{
  const id = crypto.randomUUID()
  await q(`INSERT INTO invoices (id, business_id, customer_id, customer_approval_status, tax_pricing_mode, invoice_number, issue_date, status, subtotal, total_tax, total) VALUES ($1,$2,$3,'approved','exclusive',$4,'2026-11-09','draft',$5,$6,$7)`, [id, biz, cust, "INV-"+id.slice(0,8), EXCL_NET, EXCL_TAX, EXCL_GROSS])
  const reloaded = (await q(`SELECT tax_pricing_mode, subtotal, total_tax, total FROM invoices WHERE id=$1`, [id])).rows[0]
  // edit: switch to inclusive, entered 70000 preserved (now gross)
  await q(`UPDATE invoices SET tax_pricing_mode='inclusive', subtotal=$1, total_tax=$2, total=$3 WHERE id=$4`, [INCL_NET, INCL_TAX, INCL_GROSS, id])
  const edited = (await q(`SELECT tax_pricing_mode, subtotal, total_tax, total FROM invoices WHERE id=$1`, [id])).rows[0]
  results.invoice = { reloaded, edited }
}

// ---- BILL round-trip ----
{
  const id = crypto.randomUUID()
  await q(`INSERT INTO bills (id, business_id, supplier_name, bill_number, issue_date, status, subtotal, total_tax, total, tax_pricing_mode) VALUES ($1,$2,'S',$3,'2026-11-09','draft',$4,$5,$6,'exclusive')`, [id, biz, "B-"+id.slice(0,8), EXCL_NET, EXCL_TAX, EXCL_GROSS])
  const reloaded = (await q(`SELECT tax_pricing_mode, subtotal, total_tax, total FROM bills WHERE id=$1`, [id])).rows[0]
  await q(`UPDATE bills SET tax_pricing_mode='inclusive', subtotal=$1, total_tax=$2, total=$3 WHERE id=$4`, [INCL_NET, INCL_TAX, INCL_GROSS, id])
  const edited = (await q(`SELECT tax_pricing_mode, subtotal, total_tax, total FROM bills WHERE id=$1`, [id])).rows[0]
  results.bill = { reloaded, edited }
}

// ---- EXPENSE round-trip (amount=net base, total=gross) ----
{
  const id = crypto.randomUUID()
  await q(`INSERT INTO expenses (id, business_id, supplier, amount, total, date, tax_pricing_mode) VALUES ($1,$2,'S',$3,$4,'2026-11-09','exclusive')`, [id, biz, EXCL_NET, EXCL_GROSS])
  const reloaded = (await q(`SELECT tax_pricing_mode, amount, total FROM expenses WHERE id=$1`, [id])).rows[0]
  await q(`UPDATE expenses SET tax_pricing_mode='inclusive', amount=$1, total=$2 WHERE id=$3`, [INCL_NET, INCL_GROSS, id])
  const edited = (await q(`SELECT tax_pricing_mode, amount, total FROM expenses WHERE id=$1`, [id])).rows[0]
  results.expense = { reloaded, edited }
}

console.log("Entered 70,000: exclusive -> net", EXCL_NET, "tax", EXCL_TAX, "gross", EXCL_GROSS)
console.log("Entered 70,000: inclusive (mode switch) -> net", INCL_NET, "tax", INCL_TAX, "gross", INCL_GROSS, "\n")

for (const [doc, r] of Object.entries(results)) {
  console.log(`=== ${doc} ===`)
  console.log("  after create (exclusive):", JSON.stringify(r.reloaded))
  console.log("  after edit  (inclusive):", JSON.stringify(r.edited))
}

// assertions
const assert = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); process.exitCode = 1 } }
const ok = (r, mode) => {
  if (mode === "exclusive") {
    assert(Number(r.subtotal ?? r.amount) === EXCL_NET, "exclusive net")
    assert(Number(r.total ?? r.total_tax ?? 0) === (r.total !== undefined ? EXCL_GROSS : EXCL_TAX), "exclusive gross/tax")
  } else {
    assert(Number(r.subtotal ?? r.amount) === INCL_NET, "inclusive net")
  }
  assert(r.tax_pricing_mode === mode, "mode " + mode)
}
ok(results.invoice.reloaded, "exclusive")
ok(results.invoice.edited, "inclusive")
ok(results.bill.reloaded, "exclusive")
ok(results.bill.edited, "inclusive")
ok(results.expense.reloaded, "exclusive")
ok(results.expense.edited, "inclusive")

console.log(process.exitCode ? "\nROUND-TRIP: FAILURES" : "\nROUND-TRIP: ALL PASS")
await client.end()
