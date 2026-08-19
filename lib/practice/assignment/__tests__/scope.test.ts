import {
  assertAssignedClientAccess,
  assertTaskAssigneeAllowed,
  loadFirmUserClientScope,
} from "../scope"

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

const now = new Date("2026-08-19T12:00:00.000Z")

describe("assignment scope", () => {
  it("lets a partner access an unassigned effective client", async () => {
    const supabase = {
      from: filterableFrom({
        accounting_firm_users: [{ firm_id: "firm-a", role: "partner", user_id: "partner-1" }],
        accounting_firm_client_assignments: [
          { id: "asg-1", firm_id: "firm-a", user_id: "senior-1", client_business_id: "biz-a", unassigned_at: null },
        ],
      }),
    }
    const result = await assertAssignedClientAccess({
      supabase: supabase as never,
      userId: "partner-1",
      firmId: "firm-a",
      businessId: "biz-b",
      role: "partner",
    })
    expect(result.allowed).toBe(true)
  })

  it("denies an unassigned senior after assignment enforcement is enabled", async () => {
    const supabase = {
      from: filterableFrom({
        accounting_firm_users: [{ firm_id: "firm-a", role: "senior", user_id: "senior-1" }],
        accounting_firms: [{ id: "firm-a", assignment_scope_enabled_at: "2026-08-19T00:00:00.000Z" }],
        accounting_firm_client_assignments: [
          { id: "asg-1", firm_id: "firm-a", user_id: "other", client_business_id: "biz-a", unassigned_at: null },
        ],
      }),
    }
    const result = await assertAssignedClientAccess({
      supabase: supabase as never,
      userId: "senior-1",
      firmId: "firm-a",
      businessId: "biz-a",
      role: "senior",
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe("CLIENT_NOT_ASSIGNED")
  })

  it("allows an assigned junior and keeps engagement intersection in loadFirmUserClientScope", async () => {
    const supabase = {
      from: filterableFrom({
        accounting_firm_users: [{ firm_id: "firm-a", role: "junior", user_id: "junior-1" }],
        accounting_firms: [{ id: "firm-a", assignment_scope_enabled_at: "2026-08-19T00:00:00.000Z" }],
        firm_client_engagements: [
          {
            accounting_firm_id: "firm-a",
            client_business_id: "biz-a",
            status: "accepted",
            effective_from: "2026-01-01",
            effective_to: null,
          },
          {
            accounting_firm_id: "firm-a",
            client_business_id: "biz-suspended",
            status: "suspended",
            effective_from: "2026-01-01",
            effective_to: null,
          },
          {
            accounting_firm_id: "firm-a",
            client_business_id: "biz-b",
            status: "accepted",
            effective_from: "2026-01-01",
            effective_to: null,
          },
        ],
        accounting_firm_client_assignments: [
          { id: "asg-1", firm_id: "firm-a", user_id: "junior-1", client_business_id: "biz-a", unassigned_at: null },
          {
            id: "asg-2",
            firm_id: "firm-a",
            user_id: "junior-1",
            client_business_id: "biz-suspended",
            unassigned_at: null,
          },
        ],
      }),
    }
    const scope = await loadFirmUserClientScope(supabase as never, {
      userId: "junior-1",
      firmId: "firm-a",
      now,
    })
    expect(scope?.authorizedBusinessIds).toEqual(["biz-a"])
    expect(scope?.enforcementActive).toBe(true)
  })

  it("does not grant access from assignment when the engagement is not effective", async () => {
    const supabase = {
      from: filterableFrom({
        accounting_firm_users: [{ firm_id: "firm-a", role: "senior", user_id: "senior-1" }],
        accounting_firms: [{ id: "firm-a", assignment_scope_enabled_at: "2026-08-19T00:00:00.000Z" }],
        firm_client_engagements: [
          {
            accounting_firm_id: "firm-a",
            client_business_id: "biz-x",
            status: "suspended",
            effective_from: "2026-01-01",
            effective_to: null,
          },
        ],
        accounting_firm_client_assignments: [
          { id: "asg-1", firm_id: "firm-a", user_id: "senior-1", client_business_id: "biz-x", unassigned_at: null },
        ],
      }),
    }
    const scope = await loadFirmUserClientScope(supabase as never, {
      userId: "senior-1",
      firmId: "firm-a",
      now,
    })
    expect(scope?.authorizedBusinessIds).toEqual([])
  })

  it("prevents assigning a task to staff without client access", async () => {
    const supabase = {
      from: filterableFrom({
        accounting_firm_users: [{ firm_id: "firm-a", role: "junior", user_id: "junior-1" }],
        accounting_firms: [{ id: "firm-a", assignment_scope_enabled_at: "2026-08-19T00:00:00.000Z" }],
        accounting_firm_client_assignments: [
          { id: "asg-1", firm_id: "firm-a", user_id: "other", client_business_id: "biz-a", unassigned_at: null },
        ],
      }),
    }
    const denied = await assertTaskAssigneeAllowed({
      supabase: supabase as never,
      firmId: "firm-a",
      businessId: "biz-a",
      assigneeUserId: "junior-1",
    })
    expect(denied.allowed).toBe(false)

    const assignedSupabase = {
      from: filterableFrom({
        accounting_firm_users: [{ firm_id: "firm-a", role: "junior", user_id: "junior-1" }],
        accounting_firms: [{ id: "firm-a", assignment_scope_enabled_at: "2026-08-19T00:00:00.000Z" }],
        accounting_firm_client_assignments: [
          { id: "asg-1", firm_id: "firm-a", user_id: "junior-1", client_business_id: "biz-a", unassigned_at: null },
        ],
      }),
    }
    const allowed = await assertTaskAssigneeAllowed({
      supabase: assignedSupabase as never,
      firmId: "firm-a",
      businessId: "biz-a",
      assigneeUserId: "junior-1",
    })
    expect(allowed.allowed).toBe(true)
  })

  it("allows a partner to remain a task assignee without an explicit client assignment", async () => {
    const supabase = {
      from: filterableFrom({
        accounting_firm_users: [{ firm_id: "firm-a", role: "partner", user_id: "partner-1" }],
        accounting_firm_client_assignments: [
          { id: "asg-1", firm_id: "firm-a", user_id: "senior-1", client_business_id: "biz-a", unassigned_at: null },
        ],
      }),
    }
    const result = await assertTaskAssigneeAllowed({
      supabase: supabase as never,
      firmId: "firm-a",
      businessId: "biz-a",
      assigneeUserId: "partner-1",
    })
    expect(result.allowed).toBe(true)
  })

  it("isolates assignment rows by firm_id", async () => {
    const supabase = {
      from: filterableFrom({
        accounting_firm_users: [{ firm_id: "firm-a", role: "senior", user_id: "multi-1" }],
        accounting_firms: [{ id: "firm-a", assignment_scope_enabled_at: "2026-08-19T00:00:00.000Z" }],
        firm_client_engagements: [
          {
            accounting_firm_id: "firm-a",
            client_business_id: "biz-a",
            status: "accepted",
            effective_from: "2026-01-01",
            effective_to: null,
          },
        ],
        accounting_firm_client_assignments: [
          { id: "asg-b", firm_id: "firm-b", user_id: "multi-1", client_business_id: "biz-b", unassigned_at: null },
          { id: "asg-a", firm_id: "firm-a", user_id: "other", client_business_id: "biz-a", unassigned_at: null },
        ],
      }),
    }
    const scope = await loadFirmUserClientScope(supabase as never, {
      userId: "multi-1",
      firmId: "firm-a",
      now,
    })
    expect(scope?.authorizedBusinessIds).toEqual([])
    expect(scope?.assignedBusinessIds).toEqual([])
  })

  it("keeps enforcement on after all assignment rows are removed", async () => {
    const supabase = {
      from: filterableFrom({
        accounting_firm_users: [{ firm_id: "firm-a", role: "senior", user_id: "senior-1" }],
        accounting_firms: [{ id: "firm-a", assignment_scope_enabled_at: "2026-08-19T00:00:00.000Z" }],
        firm_client_engagements: [
          {
            accounting_firm_id: "firm-a",
            client_business_id: "biz-a",
            status: "accepted",
            effective_from: "2026-01-01",
            effective_to: null,
          },
        ],
        accounting_firm_client_assignments: [],
      }),
    }
    const scope = await loadFirmUserClientScope(supabase as never, {
      userId: "senior-1",
      firmId: "firm-a",
      now,
    })
    expect(scope?.enforcementActive).toBe(true)
    expect(scope?.authorizedBusinessIds).toEqual([])
  })

  it("lets a senior see effective clients while enforcement is off", async () => {
    const supabase = {
      from: filterableFrom({
        accounting_firm_users: [{ firm_id: "firm-a", role: "senior", user_id: "senior-1" }],
        accounting_firms: [{ id: "firm-a", assignment_scope_enabled_at: null }],
        firm_client_engagements: [
          {
            accounting_firm_id: "firm-a",
            client_business_id: "biz-a",
            status: "accepted",
            effective_from: "2026-01-01",
            effective_to: null,
          },
          {
            accounting_firm_id: "firm-a",
            client_business_id: "biz-b",
            status: "accepted",
            effective_from: "2026-01-01",
            effective_to: null,
          },
        ],
        accounting_firm_client_assignments: [],
      }),
    }
    const scope = await loadFirmUserClientScope(supabase as never, {
      userId: "senior-1",
      firmId: "firm-a",
      now,
    })
    expect(scope?.enforcementActive).toBe(false)
    expect(scope?.authorizedBusinessIds).toEqual(["biz-a", "biz-b"])
  })
})
