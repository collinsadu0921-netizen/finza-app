import { getAccountingAuthority } from "../authorityEngine"

type Row = Record<string, unknown>

function filterableFrom(tables: Record<string, Row[]>) {
  return (table: string) => {
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
    api.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve)
    return api
  }
}

function supabase(tables: Record<string, Row[]>) {
  return { from: filterableFrom(tables) } as never
}

const engagement = {
  id: "eng-1",
  accounting_firm_id: "firm-a",
  client_business_id: "biz-a",
  status: "accepted",
  access_level: "read",
  effective_from: "2026-01-01",
  effective_to: null,
}

describe("getAccountingAuthority assignment scope", () => {
  it("allows a partner without an explicit assignment", async () => {
    const result = await getAccountingAuthority({
      supabase: supabase({
        accounting_firm_users: [{ firm_id: "firm-a", role: "partner", user_id: "partner-1" }],
        accounting_firms: [{ id: "firm-a", assignment_scope_enabled_at: "2026-08-19T00:00:00.000Z" }],
        firm_client_engagements: [engagement],
        accounting_firm_client_assignments: [
          { id: "asg-1", firm_id: "firm-a", user_id: "senior-1", client_business_id: "biz-a", unassigned_at: null },
        ],
      }),
      firmUserId: "partner-1",
      businessId: "biz-a",
      requiredLevel: "read",
    })
    expect(result.allowed).toBe(true)
    expect(result.reason).toBe("ACTIVE")
  })

  it("allows an assigned senior and denies an unassigned senior", async () => {
    const assigned = await getAccountingAuthority({
      supabase: supabase({
        accounting_firm_users: [{ firm_id: "firm-a", role: "senior", user_id: "senior-1" }],
        accounting_firms: [{ id: "firm-a", assignment_scope_enabled_at: "2026-08-19T00:00:00.000Z" }],
        firm_client_engagements: [engagement],
        accounting_firm_client_assignments: [
          { id: "asg-1", firm_id: "firm-a", user_id: "senior-1", client_business_id: "biz-a", unassigned_at: null },
        ],
      }),
      firmUserId: "senior-1",
      businessId: "biz-a",
    })
    expect(assigned.allowed).toBe(true)

    const unassigned = await getAccountingAuthority({
      supabase: supabase({
        accounting_firm_users: [{ firm_id: "firm-a", role: "senior", user_id: "senior-2" }],
        accounting_firms: [{ id: "firm-a", assignment_scope_enabled_at: "2026-08-19T00:00:00.000Z" }],
        firm_client_engagements: [engagement],
        accounting_firm_client_assignments: [
          { id: "asg-1", firm_id: "firm-a", user_id: "senior-1", client_business_id: "biz-a", unassigned_at: null },
        ],
      }),
      firmUserId: "senior-2",
      businessId: "biz-a",
    })
    expect(unassigned.allowed).toBe(false)
    expect(unassigned.reason).toBe("CLIENT_NOT_ASSIGNED")
  })

  it("denies URL tampering to another firm's client", async () => {
    const result = await getAccountingAuthority({
      supabase: supabase({
        accounting_firm_users: [{ firm_id: "firm-a", role: "partner", user_id: "partner-1" }],
        firm_client_engagements: [],
        accounting_firm_client_assignments: [],
      }),
      firmUserId: "partner-1",
      businessId: "biz-other-firm",
    })
    expect(result.allowed).toBe(false)
  })

  it("denies a suspended engagement even when assigned", async () => {
    const result = await getAccountingAuthority({
      supabase: supabase({
        accounting_firm_users: [{ firm_id: "firm-a", role: "senior", user_id: "senior-1" }],
        firm_client_engagements: [{ ...engagement, status: "suspended" }],
        accounting_firm_client_assignments: [
          { id: "asg-1", firm_id: "firm-a", user_id: "senior-1", client_business_id: "biz-a", unassigned_at: null },
        ],
      }),
      firmUserId: "senior-1",
      businessId: "biz-a",
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).not.toBe("CLIENT_NOT_ASSIGNED")
  })

  it("keeps access_level as the action gate after assignment", async () => {
    const result = await getAccountingAuthority({
      supabase: supabase({
        accounting_firm_users: [{ firm_id: "firm-a", role: "junior", user_id: "junior-1" }],
        accounting_firms: [{ id: "firm-a", assignment_scope_enabled_at: "2026-08-19T00:00:00.000Z" }],
        firm_client_engagements: [{ ...engagement, access_level: "read" }],
        accounting_firm_client_assignments: [
          { id: "asg-1", firm_id: "firm-a", user_id: "junior-1", client_business_id: "biz-a", unassigned_at: null },
        ],
      }),
      firmUserId: "junior-1",
      businessId: "biz-a",
      requiredLevel: "write",
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe("INSUFFICIENT_ACCESS_LEVEL")
  })
})
