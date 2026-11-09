/* eslint-disable no-console */
/**
 * Ledger posting security correction (migration 627, F-01).
 *
 * Runs against an isolated database. The script sets database roles outside
 * PL/pgSQL blocks, matching the PostgREST execution model, and rolls back all
 * data at the end.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node supabase/tests/database/ledger_posting_security_627.test.js
 */
const crypto = require("crypto")
const { Client } = require("pg")

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:55332/finza_tax_test"

function uuid() {
  return crypto.randomUUID()
}

async function main() {
  const client = new Client({ connectionString: DATABASE_URL })
  await client.connect()

  const ids = {
    accountant: uuid(),
    readonly: uuid(),
    staff: uuid(),
    outsider: uuid(),
    biz: uuid(),
    bizB: uuid(),
    bizLocked: uuid(),
  }

  const q = (text, params) => client.query(text, params)

  async function setClaims(userId, role = "authenticated") {
    await q("select set_config('request.jwt.claim.sub', $1, true)", [userId || ""])
    await q("select set_config('request.jwt.claim.role', $1, true)", [role])
    await q("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role, sub: userId || undefined }),
    ])
  }

  let savepointCounter = 0
  async function expectError(label, sql, params, pattern) {
    const sp = `expected_error_${savepointCounter++}`
    await q(`savepoint ${sp}`)
    try {
      await q(sql, params)
    } catch (error) {
      await q(`rollback to savepoint ${sp}`)
      await q(`release savepoint ${sp}`)
      if (!pattern.test(error.message)) {
        throw new Error(
          `${label}: expected ${pattern} but received: ${error.message}`
        )
      }
      return error
    }
    await q(`release savepoint ${sp}`)
    throw new Error(`${label}: expected an error, but the call succeeded`)
  }

  async function postJournal({ businessId, ar, bank, actor, source = "accountant", createdBy = null, description }) {
    const lines = JSON.stringify([
      { account_id: ar, debit: 1 },
      { account_id: bank, credit: 1 },
    ])
    return q(
      `select public.post_journal_entry(
         p_business_id => $1,
         p_date => CURRENT_DATE,
         p_description => $2,
         p_reference_type => 'adjustment',
         p_reference_id => NULL,
         p_lines => $3::jsonb,
         p_is_adjustment => TRUE,
         p_adjustment_reason => $2,
         p_created_by => $4,
         p_posted_by_accountant_id => $5,
         p_posting_source => $6
       ) as je`,
      [businessId, description, lines, createdBy, actor, source]
    )
  }

  try {
    await q("begin")

    const ownerResult = await q(
      "select id from auth.users order by created_at limit 1"
    )
    if (ownerResult.rowCount !== 1) {
      throw new Error("TEST_SETUP: need an auth.users row")
    }
    const owner = ownerResult.rows[0].id

    await q("select set_config('request.jwt.claim.sub', $1, true)", [owner])
    await q("select set_config('request.jwt.claim.role', 'authenticated', true)")
    await q("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role: "authenticated", sub: owner }),
    ])

    for (const [id, email] of [
      [ids.accountant, "security-accountant@example.invalid"],
      [ids.readonly, "security-readonly@example.invalid"],
      [ids.staff, "security-staff@example.invalid"],
      [ids.outsider, "security-outsider@example.invalid"],
    ]) {
      await q("insert into auth.users (id,email) values ($1,$2)", [id, email])
      await q("insert into public.users (id,email) values ($1,$2)", [id, email])
    }

    await q(
      `insert into public.businesses
         (id,name,address_country,default_currency,industry,owner_id,
          service_subscription_tier,service_subscription_status,billing_exempt,
          created_at,updated_at)
       values
         ($1,'627 Security Test A','Ghana','GHS','service',$4,'business','active',true,now(),now()),
         ($2,'627 Security Test B','Ghana','GHS','service',$4,'business','active',true,now(),now()),
         ($3,'627 Security Test Locked','Ghana','GHS','service',$4,'business','locked',false,now(),now())`,
      [ids.biz, ids.bizB, ids.bizLocked, owner]
    )

    for (const businessId of [ids.biz, ids.bizB, ids.bizLocked]) {
      await q("select public.create_system_accounts($1)", [businessId])
      await q("select public.initialize_business_chart_of_accounts($1)", [businessId])
      await q(
        `insert into public.accounting_periods
           (business_id,period_start,period_end,status)
         values ($1,date_trunc('month',current_date)::date,
           (date_trunc('month',current_date)+interval '1 month - 1 day')::date,
           'open')`,
        [businessId]
      )
    }

    async function account(businessId, code) {
      const result = await q(
        "select id from public.accounts where business_id=$1 and code=$2 and deleted_at is null",
        [businessId, code]
      )
      if (result.rowCount !== 1) {
        throw new Error(`TEST_SETUP: account ${code} missing for ${businessId}`)
      }
      return result.rows[0].id
    }

    const ar = await account(ids.biz, "1100")
    const bank = await account(ids.biz, "1010")
    const arB = await account(ids.bizB, "1100")
    const bankB = await account(ids.bizB, "1010")
    const arLocked = await account(ids.bizLocked, "1100")
    const bankLocked = await account(ids.bizLocked, "1010")

    await q(
      `insert into public.business_users
         (business_id,user_id,role,accountant_readonly)
       values
         ($1,$2,'accountant',false),
         ($1,$3,'accountant',true),
         ($1,$4,'staff',false)`,
      [ids.biz, ids.accountant, ids.readonly, ids.staff]
    )

    const remittanceResult = await q(
      `insert into public.wht_remittances
         (business_id,remittance_date,amount,reference,created_by)
       values ($1,current_date,5,'SEC-627-WHT',$2)
       returning id`,
      [ids.biz, owner]
    )
    const remittance = remittanceResult.rows[0].id

    // ------------------------------------------------------------------------
    // Anonymous ACLs
    // ------------------------------------------------------------------------
    await q("set role anon")
    await setClaims("", "anon")

    await expectError(
      "anon post_journal_entry",
      `select public.post_journal_entry(
         p_business_id => $1, p_date => CURRENT_DATE, p_description => 'anon',
         p_reference_type => 'adjustment', p_reference_id => NULL,
         p_lines => $2::jsonb, p_is_adjustment => TRUE,
         p_adjustment_reason => 'anon', p_posting_source => 'system')`,
      [
        ids.biz,
        JSON.stringify([
          { account_id: ar, debit: 1 },
          { account_id: bank, credit: 1 },
        ]),
      ],
      /permission denied for function|insufficient_privilege/i
    )

    await expectError(
      "anon post_wht_remittance_to_ledger",
      "select public.post_wht_remittance_to_ledger($1,'1010')",
      [remittance],
      /permission denied for function|insufficient_privilege/i
    )

    await expectError(
      "anon post_journal_entry_with_request_metadata",
      `select public.post_journal_entry_with_request_metadata(
         $1, CURRENT_DATE, 'anon metadata', 'adjustment', NULL,
         $2::jsonb, TRUE, 'anon metadata', NULL, $3,
         NULL, NULL, NULL, NULL, 'system', FALSE, NULL,
         '127.0.0.1', 'anon')`,
      [
        ids.biz,
        JSON.stringify([
          { account_id: ar, debit: 1 },
          { account_id: bank, credit: 1 },
        ]),
        owner,
      ],
      /permission denied for function|insufficient_privilege/i
    )

    await expectError(
      "anon post_adjustment_to_ledger",
      `select public.post_adjustment_to_ledger(
         $1, CURRENT_DATE,
         '[{"account_code":"1100","debit_amount":1},{"account_code":"1010","credit_amount":1}]'::jsonb,
         'anon adjustment', NULL)`,
      [ids.biz],
      /permission denied for function|insufficient_privilege/i
    )

    await q("reset role")

    // ------------------------------------------------------------------------
    // Authenticated authorization
    // ------------------------------------------------------------------------
    await q("set role authenticated")

    await setClaims(ids.accountant)
    const accountantPost = await postJournal({
      businessId: ids.biz,
      ar,
      bank,
      actor: ids.accountant,
      description: "authorized accountant journal",
    })
    if (!accountantPost.rows[0].je) {
      throw new Error("authorized accountant did not post")
    }

    await setClaims(owner)
    const ownerPost = await postJournal({
      businessId: ids.biz,
      ar,
      bank,
      actor: owner,
      description: "authorized owner journal",
    })
    if (!ownerPost.rows[0].je) {
      throw new Error("authorized owner did not post")
    }

    await setClaims(ids.outsider)
    await expectError(
      "non-member post",
      `select public.post_journal_entry(
         p_business_id => $1, p_date => CURRENT_DATE, p_description => 'outsider',
         p_reference_type => 'adjustment', p_reference_id => NULL,
         p_lines => $2::jsonb, p_is_adjustment => TRUE,
         p_adjustment_reason => 'outsider', p_posting_source => 'accountant')`,
      [
        ids.biz,
        JSON.stringify([
          { account_id: ar, debit: 1 },
          { account_id: bank, credit: 1 },
        ]),
      ],
      /LEDGER_POSTING_FORBIDDEN/
    )

    await setClaims(ids.readonly)
    await expectError(
      "read-only accountant post",
      `select public.post_journal_entry(
         p_business_id => $1, p_date => CURRENT_DATE, p_description => 'readonly',
         p_reference_type => 'adjustment', p_reference_id => NULL,
         p_lines => $2::jsonb, p_is_adjustment => TRUE,
         p_adjustment_reason => 'readonly', p_posting_source => 'accountant')`,
      [
        ids.biz,
        JSON.stringify([
          { account_id: ar, debit: 1 },
          { account_id: bank, credit: 1 },
        ]),
      ],
      /LEDGER_POSTING_READ_ONLY/
    )

    await setClaims(ids.staff)
    await expectError(
      "staff post",
      `select public.post_journal_entry(
         p_business_id => $1, p_date => CURRENT_DATE, p_description => 'staff',
         p_reference_type => 'adjustment', p_reference_id => NULL,
         p_lines => $2::jsonb, p_is_adjustment => TRUE,
         p_adjustment_reason => 'staff', p_posting_source => 'accountant')`,
      [
        ids.biz,
        JSON.stringify([
          { account_id: ar, debit: 1 },
          { account_id: bank, credit: 1 },
        ]),
      ],
      /LEDGER_POSTING_PERMISSION_DENIED/
    )

    await setClaims(owner)
    await expectError(
      "cross-tenant accounts",
      `select public.post_journal_entry(
         p_business_id => $1, p_date => CURRENT_DATE, p_description => 'cross tenant',
         p_reference_type => 'adjustment', p_reference_id => NULL,
         p_lines => $2::jsonb, p_is_adjustment => TRUE,
         p_adjustment_reason => 'cross tenant', p_posted_by_accountant_id => $3,
         p_posting_source => 'accountant')`,
      [
        ids.biz,
        JSON.stringify([
          { account_id: arB, debit: 1 },
          { account_id: bankB, credit: 1 },
        ]),
        owner,
      ],
      /LEDGER_POSTING_ACCOUNT_INVALID/
    )

    await expectError(
      "actor spoofing",
      `select public.post_journal_entry(
         p_business_id => $1, p_date => CURRENT_DATE, p_description => 'spoofed actor',
         p_reference_type => 'adjustment', p_reference_id => NULL,
         p_lines => $2::jsonb, p_is_adjustment => TRUE,
         p_adjustment_reason => 'spoofed actor', p_created_by => $3,
         p_posting_source => 'accountant')`,
      [
        ids.biz,
        JSON.stringify([
          { account_id: ar, debit: 1 },
          { account_id: bank, credit: 1 },
        ]),
        ids.accountant,
      ],
      /LEDGER_POSTING_ACTOR_FORBIDDEN/
    )

    await expectError(
      "invalid posting source",
      `select public.post_journal_entry(
         p_business_id => $1, p_date => CURRENT_DATE, p_description => 'bad source',
         p_reference_type => 'adjustment', p_reference_id => NULL,
         p_lines => $2::jsonb, p_is_adjustment => TRUE,
         p_adjustment_reason => 'bad source', p_posting_source => 'bogus')`,
      [
        ids.biz,
        JSON.stringify([
          { account_id: ar, debit: 1 },
          { account_id: bank, credit: 1 },
        ]),
      ],
      /posting_source must be/
    )

    await expectError(
      "locked subscription",
      `select public.post_journal_entry(
         p_business_id => $1, p_date => CURRENT_DATE, p_description => 'locked subscription',
         p_reference_type => 'adjustment', p_reference_id => NULL,
         p_lines => $2::jsonb, p_is_adjustment => TRUE,
         p_adjustment_reason => 'locked subscription',
         p_posted_by_accountant_id => $3, p_posting_source => 'accountant')`,
      [
        ids.bizLocked,
        JSON.stringify([
          { account_id: arLocked, debit: 1 },
          { account_id: bankLocked, credit: 1 },
        ]),
        owner,
      ],
      /LEDGER_POSTING_SUBSCRIPTION_READ_ONLY/
    )

    await setClaims(owner)

    await q("reset role")

    // ------------------------------------------------------------------------
    // Service-role posting, WHT idempotency and rollback
    // ------------------------------------------------------------------------
    await q("set role service_role")
    await setClaims("", "service_role")

    const servicePost = await postJournal({
      businessId: ids.biz,
      ar,
      bank,
      actor: null,
      source: "system",
      description: "service role journal",
    })
    if (!servicePost.rows[0].je) {
      throw new Error("service role did not post")
    }

    const whtFirst = await q(
      "select public.post_wht_remittance_to_ledger($1,'1010') as je",
      [remittance]
    )
    const whtSecond = await q(
      "select public.post_wht_remittance_to_ledger($1,'1010') as je",
      [remittance]
    )
    if (whtFirst.rows[0].je !== whtSecond.rows[0].je) {
      throw new Error("WHT posting was not idempotent")
    }

    let metadata
    try {
      metadata = await q(
      `select public.post_journal_entry_with_request_metadata(
         $1, CURRENT_DATE, 'service metadata', 'adjustment', NULL,
         $2::jsonb, TRUE, 'service metadata', NULL, $3,
         NULL, NULL, NULL, NULL, 'system', FALSE, NULL,
         '127.0.0.1', 'service') as je`,
      [
        ids.biz,
        JSON.stringify([
          { account_id: ar, debit: 5 },
          { account_id: bank, credit: 5 },
        ]),
        owner,
      ]
      )
    } catch (error) {
      console.error("metadata call error:", error.message, error.where, error.context)
      throw error
    }
    if (!metadata.rows[0].je) {
      throw new Error("service-role metadata wrapper failed")
    }

    await expectError(
      "unbalanced journal",
      `select public.post_journal_entry(
         p_business_id => $1, p_date => CURRENT_DATE, p_description => 'unbalanced service journal',
         p_reference_type => 'adjustment', p_reference_id => NULL,
         p_lines => $2::jsonb, p_is_adjustment => TRUE,
         p_adjustment_reason => 'unbalanced service journal',
         p_posting_source => 'system')`,
      [
        ids.biz,
        JSON.stringify([
          { account_id: ar, debit: 10 },
          { account_id: bank, credit: 9 },
        ]),
      ],
      /balance/i
    )

    await q("reset role")

    const finalCounts = await q(
      `select
         count(*) filter (where description = 'unbalanced service journal')::int as unbalanced,
         count(*) filter (where reference_type = 'wht_remittance' and reference_id = $2)::int as wht
       from public.journal_entries
       where business_id = $1`,
      [ids.biz, remittance]
    )
    if (finalCounts.rows[0].unbalanced !== 0) {
      throw new Error("failed posting left journal rows")
    }
    if (finalCounts.rows[0].wht !== 1) {
      throw new Error(
        `expected exactly one WHT journal, found ${finalCounts.rows[0].wht}`
      )
    }

    console.log("PASS: ledger posting security correction (627)")
  } finally {
    await q("rollback").catch(() => {})
    await client.end().catch(() => {})
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})

