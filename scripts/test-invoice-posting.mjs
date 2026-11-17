import pg from "pg"

const client = new pg.Client({
  connectionString: "postgresql://postgres:finza_test_only@localhost:55439/finza",
})
await client.connect()

const q = (text, params) => client.query(text, params)

// ---- Seed ----
const biz = "11111111-1111-1111-1111-111111111111"
const cust = "22222222-2222-2222-2222-222222222222"
const owner = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"

await q(`INSERT INTO auth.users (id, instance_id, email, is_sso_user, is_anonymous)
  VALUES ($1, '00000000-0000-0000-0000-000000000000', 'owner@test.local', false, false)
  ON CONFLICT (id) DO NOTHING`, [owner])

await q(`INSERT INTO users (id, email) VALUES ($1, 'owner@test.local') ON CONFLICT (id) DO NOTHING`, [owner])

await q(`INSERT INTO businesses (id, owner_id, name, timezone, cit_rate_code, vat_scheme, service_subscription_tier, business_type, billing_exempt, trial_contact_consent, address_country, default_currency, accounting_start_date)
 VALUES ($1,$2,'Test Business','Africa/Accra','standard_25','standard','business','limited_company',true,false,'GH','GHS','2026-01-01') ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id`, [biz, owner])

await q(`INSERT INTO customers (id, business_id, name) VALUES ($1,$2,'Test Customer') ON CONFLICT (id) DO NOTHING`, [cust, biz])

const accts = [
  ["1100", "Accounts Receivable", "asset"],
  ["4000", "Service Revenue", "revenue"],
  ["2100", "VAT Payable", "liability"],
  ["2110", "NHIL Payable", "liability"],
  ["2120", "GETFund Payable", "liability"],
  ["1010", "Bank", "asset"],
]
for (const [code, name, type] of accts) {
  await q(`INSERT INTO chart_of_accounts (business_id, account_code, account_name, account_type, is_active)
    VALUES ($1,$2,$3,$4,true) ON CONFLICT DO NOTHING`, [biz, code, name, type])
  const accountsType = type === "revenue" ? "income" : type
  await q(`INSERT INTO accounts (business_id, code, name, type, is_system)
    VALUES ($1,$2,$3,$4,true) ON CONFLICT DO NOTHING`, [biz, code, name, accountsType])
}

await q(`INSERT INTO chart_of_accounts_control_map (business_id, control_key, account_code)
  VALUES ($1,'AR','1100'), ($1,'CASH','1010'), ($1,'BANK','1010') ON CONFLICT DO NOTHING`, [biz])

// tax_lines JSONB for a GH₵70,000 net / GH₵84,000 gross invoice (post-2026)
const taxLines = {
  lines: [
    { code: "NHIL", amount: 1750, ledger_account_code: "2110", ledger_side: "credit" },
    { code: "GETFUND", amount: 1750, ledger_account_code: "2120", ledger_side: "credit" },
    { code: "VAT", amount: 10500, ledger_account_code: "2100", ledger_side: "credit" },
  ],
  meta: { jurisdiction: "GH", effective_date_used: "2026-11-09", engine_version: "test" },
}

async function journalFor(invoiceId) {
  const r = await q(
    `SELECT jel.account_id, acc.code AS account_code, jel.debit, jel.credit
     FROM journal_entries je
     JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
     JOIN accounts acc ON acc.id = jel.account_id
     WHERE je.reference_type='invoice' AND je.reference_id=$1
     ORDER BY acc.code`, [invoiceId])
  return r.rows
}

async function createAndPostInvoice(label, pricingMode) {
  const invId = crypto.randomUUID()
  const invNumber = `${label}-${invId.slice(0, 8)}`
  const taxLinesJson = { ...taxLines, pricing_mode: pricingMode }
  await q(`INSERT INTO invoices (id, business_id, customer_id, customer_approval_status, tax_pricing_mode, invoice_number, issue_date, status, subtotal, total_tax, total, tax_lines, apply_taxes)
    VALUES ($1,$2,$3,'approved',$4,$5,'2026-11-09','draft',70000,14000,84000,$6,true)
    ON CONFLICT (id) DO NOTHING`, [invId, biz, cust, pricingMode, invNumber, JSON.stringify(taxLinesJson)])

  // draft must not post
  const draftRows = await journalFor(invId)
  const draftCount = draftRows.length

  // issue
  await q(`UPDATE invoices SET status='sent', sent_at=now() WHERE id=$1`, [invId])
  const rows = await journalFor(invId)

  // idempotency: re-trigger post, should reuse
  await q(`SELECT post_invoice_to_ledger($1)`, [invId])
  const afterRepeat = await journalFor(invId)

  return { invId, draftCount, rows, afterRepeatCount: afterRepeat.length }
}

function summarize(rows) {
  const debits = rows.filter(r => Number(r.debit) > 0)
  const credits = rows.filter(r => Number(r.credit) > 0)
  const totDeb = debits.reduce((s, r) => s + Number(r.debit), 0)
  const totCred = credits.reduce((s, r) => s + Number(r.credit), 0)
  return { debits: debits.map(r => `${r.account_code}:${r.debit}`), credits: credits.map(r => `${r.account_code}:${r.credit}`), totDeb, totCred }
}

const exclusive = await createAndPostInvoice("EXCL", "exclusive")
const inclusive = await createAndPostInvoice("INCL", "inclusive")

console.log("=== exclusive invoice ===")
console.log("draft journal lines:", exclusive.draftCount, "(expect 0)")
console.log(JSON.stringify(summarize(exclusive.rows), null, 2))
console.log("after repeat lines:", exclusive.afterRepeatCount, "(expect same, no dup)")

console.log("=== inclusive invoice ===")
console.log("draft journal lines:", inclusive.draftCount, "(expect 0)")
console.log(JSON.stringify(summarize(inclusive.rows), null, 2))
console.log("after repeat lines:", inclusive.afterRepeatCount, "(expect same, no dup)")

const parity = JSON.stringify(exclusive.rows) === JSON.stringify(inclusive.rows)
console.log("=== parity (exclusive == inclusive journal):", parity, "===")

await client.end()
