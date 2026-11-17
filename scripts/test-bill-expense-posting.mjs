import pg from "pg"

const client = new pg.Client({
  connectionString: "postgresql://postgres:finza_test_only@localhost:55439/finza",
})
await client.connect()
const q = (text, params) => client.query(text, params)

const biz = "11111111-1111-1111-1111-111111111111"

// ---- Add remaining accounts + control maps ----
const extra = [
  ["2000", "Accounts Payable", "liability"],
  ["5100", "Operating Expenses", "expense"],
  ["5200", "Supplier Bills", "expense"],
]
for (const [code, name, type] of extra) {
  await q(`INSERT INTO chart_of_accounts (business_id, account_code, account_name, account_type, is_active) VALUES ($1,$2,$3,$4,true) ON CONFLICT DO NOTHING`, [biz, code, name, type])
  const accountsType = type === "revenue" ? "income" : type
  await q(`INSERT INTO accounts (business_id, code, name, type, is_system) VALUES ($1,$2,$3,$4,true) ON CONFLICT DO NOTHING`, [biz, code, name, accountsType])
}
await q(`INSERT INTO chart_of_accounts_control_map (business_id, control_key, account_code) VALUES ($1,'AP','2000') ON CONFLICT DO NOTHING`, [biz])

const inputTaxLines = {
  lines: [
    { code: "NHIL", amount: 1750, ledger_account_code: "2110", ledger_side: "debit" },
    { code: "GETFUND", amount: 1750, ledger_account_code: "2120", ledger_side: "debit" },
    { code: "VAT", amount: 10500, ledger_account_code: "2100", ledger_side: "debit" },
  ],
  meta: { jurisdiction: "GH", effective_date_used: "2026-11-09", engine_version: "test" },
}

async function journalFor(refType, refId) {
  const r = await q(
    `SELECT acc.code AS account_code, jel.debit, jel.credit
     FROM journal_entries je
     JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
     JOIN accounts acc ON acc.id = jel.account_id
     WHERE je.reference_type=$1 AND je.reference_id=$2
     ORDER BY acc.code`, [refType, refId])
  return r.rows
}

function summarize(rows) {
  const debits = rows.filter(r => Number(r.debit) > 0).map(r => `${r.account_code}:${r.debit}`)
  const credits = rows.filter(r => Number(r.credit) > 0).map(r => `${r.account_code}:${r.credit}`)
  const totDeb = rows.reduce((s, r) => s + Number(r.debit), 0)
  const totCred = rows.reduce((s, r) => s + Number(r.credit), 0)
  return { debits, credits, totDeb, totCred }
}

// ---- Standard bill test ----
async function billTest(label, pricingMode) {
  const id = crypto.randomUUID()
  const num = `BILL-${label}-${id.slice(0, 8)}`
  await q(`INSERT INTO bills (id, business_id, supplier_name, bill_number, issue_date, status, subtotal, nhil, getfund, covid, vat, total_tax, total, tax_lines, tax_pricing_mode)
    VALUES ($1,$2,'Test Supplier',$3,'2026-11-09','draft',70000,1750,1750,0,10500,14000,84000,$4,$5)`,
    [id, biz, num, JSON.stringify({ ...inputTaxLines, pricing_mode: pricingMode }), pricingMode])
  await q(`INSERT INTO bill_items (bill_id, description, qty, unit_price, line_subtotal)
    VALUES ($1,'Test line',1,84000,84000)`, [id])
  const draft = (await journalFor('bill', id)).length
  await q(`UPDATE bills SET status='open' WHERE id=$1`, [id])
  const rows = await journalFor('bill', id)
  await q(`SELECT post_bill_to_ledger($1)`, [id])
  const after = (await journalFor('bill', id)).length
  return { draft, rows, after, balanced: summarize(rows).totDeb === summarize(rows).totCred }
}

// ---- Expense test ----
async function expenseTest(label, pricingMode) {
  const id = crypto.randomUUID()
  await q(`INSERT INTO expenses (id, business_id, supplier, amount, nhil, getfund, covid, vat, total, date, tax_pricing_mode)
    VALUES ($1,$2,'Test Supplier',70000,1750,1750,0,10500,84000,'2026-11-09',$3)`,
    [id, biz, pricingMode])
  const rows = await journalFor('expense', id)
  await q(`SELECT post_expense_to_ledger($1)`, [id])
  const after = (await journalFor('expense', id)).length
  return { rows, after, balanced: summarize(rows).totDeb === summarize(rows).totCred }
}

console.log("=== STANDARD BILL exclusive (net 70k) ===")
const bEx = await billTest("EXCL", "exclusive")
console.log("draft lines:", bEx.draft, "| after repeat:", bEx.after, "| balanced:", bEx.balanced)
console.log(JSON.stringify(summarize(bEx.rows), null, 2))

console.log("=== STANDARD BILL inclusive (gross 84k) ===")
const bIn = await billTest("INCL", "inclusive")
console.log("draft lines:", bIn.draft, "| after repeat:", bIn.after, "| balanced:", bIn.balanced)
console.log(JSON.stringify(summarize(bIn.rows), null, 2))

console.log("=== bill parity:", JSON.stringify(bEx.rows) === JSON.stringify(bIn.rows), "===")

console.log("=== EXPENSE exclusive (net 70k) ===")
const eEx = await expenseTest("EXCL", "exclusive")
console.log("after repeat:", eEx.after, "| balanced:", eEx.balanced)
console.log(JSON.stringify(summarize(eEx.rows), null, 2))

console.log("=== EXPENSE inclusive (gross 84k) ===")
const eIn = await expenseTest("INCL", "inclusive")
console.log("after repeat:", eIn.after, "| balanced:", eIn.balanced)
console.log(JSON.stringify(summarize(eIn.rows), null, 2))

console.log("=== expense parity:", JSON.stringify(eEx.rows) === JSON.stringify(eIn.rows), "===")

await client.end()
