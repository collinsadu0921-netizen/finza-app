import { getAccountingAuthority } from "@/lib/accounting/authorityEngine"
import { resolveAccountingRequestAuthority } from "@/lib/accounting/resolveAccountingRequestAuthority"
import {
  CLIENT_NOT_ASSIGNED,
  ENGAGEMENT_NOT_EFFECTIVE,
  ENGAGEMENT_PENDING,
  ENGAGEMENT_SUSPENDED,
  ENGAGEMENT_TERMINATED,
} from "@/lib/accounting/reasonCodes"

type Row = Record<string, unknown>

function filterableFrom(tables: Record<string, Row[]>, queries: string[]) {
  return (table: string) => {
    queries.push(table)
    let rows = [...(tables[table] ?? [])]
    const api: Record<string, unknown> = {}
    const self = () => api
    api.select = self
    api.eq = (col: string, val: unknown) => {
      rows = rows.filter((row) => row[col] === val)
      return api
    }
    api.in = (col: string, ids: unknown[]) => {
      rows = rows.filter((row) => ids.includes(row[col]))
      return api
    }
    api.is = (col: string, val: unknown) => {
      rows = rows.filter((row) => (val === null ? row[col] == null : row[col] === val))
      return api
    }
    api.limit = self
    api.maybeSingle = async () => ({ data: rows[0] ?? null, error: null })
    api.single = async () => ({ data: rows[0] ?? null, error: null })
    api.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve)
    return api
  }
}

function supabase(tables: Record<string, Row[]>, queries: string[] = []) {
  return { from: filterableFrom(tables, queries), queries } as never & { queries: string[] }
}

const engagement = {
  id: "eng-1",
  accounting_firm_id: "firm-a",
  client_business_id: "biz-a",
  status: "accepted",
  access_level: "write",
  effective_from: "2026-01-01",
  effective_to: null,
}

function practiceTables(overrides: Record<string, Row[]> = {}) {
  return {
    businesses: [{ id: "biz-a", owner_id: "client-owner" }],
    business_users: [] as Row[],
    accounting_firm_users: [{ firm_id: "firm-a", role: "partner", user_id: "partner-1" }],
    accounting_firms: [{ id: "firm-a", assignment_scope_enabled_at: "2026-08-19T00:00:00.000Z" }],
    firm_client_engagements: [engagement],
    accounting_firm_client_assignments: [] as Row[],
    ...overrides,
  }
}

function snapshot(result: Awaited<ReturnType<typeof resolveAccountingRequestAuthority>>) {
  if (!result.ok) {
    return {
      ok: false as const,
      status: result.status,
      reasonCode: result.reasonCode,
      businessId: result.businessId,
    }
  }
  return {
    ok: true as const,
    grantedLevel: result.grantedLevel,
    authoritySource: result.authoritySource,
    isPractice: result.isPractice,
    firmId: result.firmId,
    engagementId: result.engagementId,
    engagementStatus: result.engagementStatus,
    reason: result.reason,
  }
}

async function bothStrategies(
  tables: Record<string, Row[]>,
  requiredLevel: "read" | "write" | "approve",
  userId: string,
  businessId = "biz-a"
) {
  const sequential = await resolveAccountingRequestAuthority({
    supabase: supabase(tables),
    userId,
    businessId,
    requiredLevel,
  })
  const parallel = await resolveAccountingRequestAuthority({
    supabase: supabase(tables),
    userId,
    businessId,
    requiredLevel,
    authorityContext: "practice-client-books",
  })
  return { sequential, parallel }
}

describe("authority semantic equivalence (service-first vs parallel lookup)", () => {
  it("Service owner is unchanged", async () => {
    const tables = {
      businesses: [{ id: "biz-a", owner_id: "owner-1" }],
      business_users: [],
      accounting_firm_users: [],
      firm_client_engagements: [],
    }
    const { sequential, parallel } = await bothStrategies(tables, "approve", "owner-1")
    expect(snapshot(sequential)).toEqual(snapshot(parallel))
    expect(sequential.ok && sequential.authoritySource).toBe("owner")
    expect(sequential.ok && sequential.isPractice).toBe(false)
  })

  it("Service admin is unchanged", async () => {
    const tables = {
      businesses: [{ id: "biz-a", owner_id: "owner-1" }],
      business_users: [{ business_id: "biz-a", user_id: "admin-1", role: "admin", accountant_readonly: false }],
      accounting_firm_users: [],
      firm_client_engagements: [],
    }
    const { sequential, parallel } = await bothStrategies(tables, "write", "admin-1")
    expect(snapshot(sequential)).toEqual(snapshot(parallel))
    expect(sequential.ok && sequential.authoritySource).toBe("employee")
  })

  it("Service accountant is unchanged", async () => {
    const tables = {
      businesses: [{ id: "biz-a", owner_id: "owner-1" }],
      business_users: [
        { business_id: "biz-a", user_id: "acct-1", role: "accountant", accountant_readonly: false },
      ],
      accounting_firm_users: [],
      firm_client_engagements: [],
    }
    const { sequential, parallel } = await bothStrategies(tables, "read", "acct-1")
    expect(snapshot(sequential)).toEqual(snapshot(parallel))
    expect(sequential.ok && sequential.authoritySource).toBe("accountant")
  })

  it("Practice READ/WRITE/APPROVE match old logic", async () => {
    for (const level of ["read", "write", "approve"] as const) {
      const tables = practiceTables({
        firm_client_engagements: [{ ...engagement, access_level: "approve" }],
      })
      const { sequential, parallel } = await bothStrategies(tables, level, "partner-1")
      expect(snapshot(sequential)).toEqual(snapshot(parallel))
      expect(sequential.ok).toBe(true)
      if (sequential.ok) {
        expect(sequential.grantedLevel).toBe("approve")
        expect(sequential.isPractice).toBe(true)
        expect(sequential.engagementStatus).toBe("accepted")
      }
    }
  })

  it("pending / suspended / terminated / ineffective keep the same reason", async () => {
    const cases = [
      { status: "pending", from: "2026-01-01", to: null, reason: ENGAGEMENT_PENDING },
      { status: "suspended", from: "2026-01-01", to: null, reason: ENGAGEMENT_SUSPENDED },
      { status: "terminated", from: "2026-01-01", to: null, reason: ENGAGEMENT_TERMINATED },
      { status: "accepted", from: "2026-12-01", to: null, reason: ENGAGEMENT_NOT_EFFECTIVE },
      { status: "accepted", from: "2026-01-01", to: "2026-01-31", reason: ENGAGEMENT_NOT_EFFECTIVE },
    ]
    for (const c of cases) {
      const tables = practiceTables({
        firm_client_engagements: [
          {
            ...engagement,
            status: c.status,
            effective_from: c.from,
            effective_to: c.to,
          },
        ],
      })
      const { sequential, parallel } = await bothStrategies(tables, "read", "partner-1")
      expect(snapshot(sequential)).toEqual(snapshot(parallel))
      expect(sequential.ok).toBe(false)
      if (!sequential.ok) expect(sequential.reasonCode).toBe(c.reason)
    }
  })

  it("assignment: assigned senior allowed, unassigned senior denied", async () => {
    const assignedTables = practiceTables({
      accounting_firm_users: [{ firm_id: "firm-a", role: "senior", user_id: "senior-1" }],
      accounting_firm_client_assignments: [
        {
          id: "asg-1",
          firm_id: "firm-a",
          user_id: "senior-1",
          client_business_id: "biz-a",
          unassigned_at: null,
        },
      ],
    })
    const unassignedTables = practiceTables({
      accounting_firm_users: [{ firm_id: "firm-a", role: "senior", user_id: "senior-2" }],
      accounting_firm_client_assignments: [
        {
          id: "asg-1",
          firm_id: "firm-a",
          user_id: "senior-1",
          client_business_id: "biz-a",
          unassigned_at: null,
        },
      ],
    })
    const assigned = await bothStrategies(assignedTables, "read", "senior-1")
    expect(snapshot(assigned.sequential)).toEqual(snapshot(assigned.parallel))
    expect(assigned.sequential.ok).toBe(true)

    const unassigned = await bothStrategies(unassignedTables, "read", "senior-2")
    expect(snapshot(unassigned.sequential)).toEqual(snapshot(unassigned.parallel))
    expect(unassigned.sequential.ok).toBe(false)
    if (!unassigned.sequential.ok) {
      expect(unassigned.sequential.reasonCode).toBe(CLIENT_NOT_ASSIGNED)
    }
  })

  it("wrong client and no firm membership deny the same way", async () => {
    const wrong = await bothStrategies(practiceTables(), "read", "partner-1", "biz-other")
    expect(snapshot(wrong.sequential)).toEqual(snapshot(wrong.parallel))
    expect(wrong.sequential.ok).toBe(false)

    const none = await bothStrategies(
      {
        businesses: [{ id: "biz-a", owner_id: "client-owner" }],
        business_users: [],
        accounting_firm_users: [],
        firm_client_engagements: [engagement],
      },
      "read",
      "stranger"
    )
    expect(snapshot(none.sequential)).toEqual(snapshot(none.parallel))
    expect(none.sequential.ok).toBe(false)
  })

  it("multi-firm selects the engagement for this client", async () => {
    const tables = practiceTables({
      accounting_firm_users: [
        { firm_id: "firm-b", role: "partner", user_id: "partner-1" },
        { firm_id: "firm-a", role: "partner", user_id: "partner-1" },
      ],
      firm_client_engagements: [
        { ...engagement, id: "eng-b", accounting_firm_id: "firm-b", client_business_id: "biz-other" },
        engagement,
      ],
    })
    const { sequential, parallel } = await bothStrategies(tables, "write", "partner-1")
    expect(snapshot(sequential)).toEqual(snapshot(parallel))
    expect(sequential.ok && sequential.firmId).toBe("firm-a")
    expect(sequential.ok && sequential.engagementId).toBe("eng-1")
  })

  it("does not query assignment tables for a partner", async () => {
    const queries: string[] = []
    await getAccountingAuthority({
      supabase: supabase(practiceTables(), queries),
      firmUserId: "partner-1",
      businessId: "biz-a",
      requiredLevel: "read",
    })
    expect(queries).not.toContain("accounting_firm_client_assignments")
    expect(queries).not.toContain("accounting_firms")
  })
})
