import { derivePracticeDashboard, isWaitingOnClient } from "../derive"
import type { PracticeDashboardDeriveInput } from "../types"
import type { PracticeWorkItem } from "@/lib/practice/work/types"

const FIRM_A = "firm-a"
const FIRM_B = "firm-b"
const PARTNER = "user-partner"
const SENIOR = "user-senior"
const JUNIOR = "user-junior"
const READONLY = "user-readonly"
const FIRM_B_PARTNER = "user-partner-b"

const CLIENT_1 = "biz-1"
const CLIENT_2 = "biz-2"
const CLIENT_3_SUSPENDED = "biz-3"
const CLIENT_B = "biz-b"

function work(partial: Partial<PracticeWorkItem> & Pick<PracticeWorkItem, "id" | "source" | "business_id">): PracticeWorkItem {
  return {
    source_id: partial.id.split(":")[1] ?? partial.id,
    business_name: partial.business_name ?? partial.business_id,
    type: partial.type ?? partial.source,
    title: partial.title ?? partial.id,
    source_status: partial.source_status ?? "pending",
    status_group: partial.status_group ?? "needs_action",
    priority: partial.priority ?? null,
    assigned_user_id: partial.assigned_user_id ?? null,
    assigned_user_name: partial.assigned_user_name ?? null,
    due_at: partial.due_at ?? null,
    created_at: partial.created_at ?? "2026-08-10T09:00:00.000Z",
    urgency: partial.urgency ?? "none",
    action_url: partial.action_url ?? `/accounting/clients/${partial.business_id}/overview`,
    assignment_supported: partial.assignment_supported ?? partial.source === "task",
    ...partial,
  }
}

const portfolioItems: PracticeWorkItem[] = [
  work({
    id: "task:overdue-1",
    source: "task",
    business_id: CLIENT_1,
    business_name: "ABC Ltd",
    title: "VAT pack",
    assigned_user_id: SENIOR,
    assigned_user_name: "Senior A",
    urgency: "overdue",
    due_at: "2026-08-18T09:00:00.000Z",
    assignment_supported: true,
  }),
  work({
    id: "task:today-1",
    source: "task",
    business_id: CLIENT_1,
    business_name: "ABC Ltd",
    title: "Review pack",
    assigned_user_id: SENIOR,
    assigned_user_name: "Senior A",
    urgency: "today",
    due_at: "2026-08-19T09:00:00.000Z",
    assignment_supported: true,
  }),
  work({
    id: "task:junior-2",
    source: "task",
    business_id: CLIENT_2,
    business_name: "BuildCo",
    title: "Bank rec",
    assigned_user_id: JUNIOR,
    assigned_user_name: "Junior A",
    urgency: "soon",
    due_at: "2026-08-22T09:00:00.000Z",
    assignment_supported: true,
  }),
  work({
    id: "task:unassigned",
    source: "task",
    business_id: CLIENT_2,
    business_name: "BuildCo",
    title: "Unassigned review",
    urgency: "overdue",
    due_at: "2026-08-17T09:00:00.000Z",
    assignment_supported: true,
  }),
  work({
    id: "request:waiting",
    source: "request",
    business_id: CLIENT_2,
    business_name: "BuildCo",
    title: "Bank statements",
    source_status: "waiting_on_client",
    status_group: "waiting",
    urgency: "soon",
    due_at: "2026-08-20T09:00:00.000Z",
    assignment_supported: false,
  }),
  work({
    id: "request:done",
    source: "request",
    business_id: CLIENT_1,
    business_name: "ABC Ltd",
    title: "Completed request",
    source_status: "completed",
    status_group: "done",
    assignment_supported: false,
  }),
  work({
    id: "journal_approval:1",
    source: "journal_approval",
    business_id: CLIENT_1,
    business_name: "ABC Ltd",
    title: "Journal awaiting approval",
    type: "Journal approval",
    assignment_supported: false,
  }),
  work({
    id: "task:suspended",
    source: "task",
    business_id: CLIENT_3_SUSPENDED,
    business_name: "Suspended Co",
    title: "Should not count",
    assigned_user_id: SENIOR,
    urgency: "overdue",
    assignment_supported: true,
  }),
  work({
    id: "task:foreign",
    source: "task",
    business_id: CLIENT_B,
    business_name: "Firm B Client",
    title: "Foreign work",
    assigned_user_id: FIRM_B_PARTNER,
    urgency: "overdue",
    assignment_supported: true,
  }),
  work({
    id: "task:clear-client",
    source: "task",
    business_id: "biz-clear",
    business_name: "Clear Ltd",
    title: "Already done",
    source_status: "completed",
    status_group: "done",
    assignment_supported: true,
  }),
]

const firmAStaff = [
  { user_id: PARTNER, name: "Partner A", role: "partner" as const },
  { user_id: SENIOR, name: "Senior A", role: "senior" as const },
  { user_id: JUNIOR, name: "Junior A", role: "junior" as const },
  { user_id: READONLY, name: "Readonly A", role: "readonly" as const },
]

const firmAAssignments = [
  { user_id: SENIOR, client_business_id: CLIENT_1 },
  { user_id: JUNIOR, client_business_id: CLIENT_1 },
  { user_id: JUNIOR, client_business_id: CLIENT_2 },
  { user_id: READONLY, client_business_id: CLIENT_2 },
  { user_id: SENIOR, client_business_id: CLIENT_3_SUSPENDED },
]

function input(partial: Partial<PracticeDashboardDeriveInput> = {}): PracticeDashboardDeriveInput {
  return {
    firmId: FIRM_A,
    role: "partner",
    currentUserId: PARTNER,
    enforcementActive: true,
    authorizedBusinessIds: [CLIENT_1, CLIENT_2],
    effectiveBusinessIds: [CLIENT_1, CLIENT_2],
    clients: [
      { id: CLIENT_1, name: "ABC Ltd" },
      { id: CLIENT_2, name: "BuildCo" },
    ],
    staff: firmAStaff,
    assignments: firmAAssignments,
    items: portfolioItems,
    ...partial,
  }
}

describe("Practice dashboard summary", () => {
  const dash = derivePracticeDashboard(input())

  it("counts authorized effective clients only", () => {
    expect(dash.summary.clients).toBe(2)
  })

  it("counts open work as needs_action + waiting and excludes completed", () => {
    expect(dash.summary.open_work).toBe(6)
    expect(dash.needs_attention.some((item) => item.status_group === "done")).toBe(false)
  })

  it("counts overdue from active work only", () => {
    expect(dash.summary.overdue).toBe(2)
  })

  it("counts waiting on client from persisted request status only", () => {
    expect(dash.summary.waiting_on_client).toBe(1)
    expect(dash.waiting_on_client.items.every(isWaitingOnClient)).toBe(true)
  })

  it("does not invent waiting duration", () => {
    expect(dash.waiting_on_client.waiting_duration_available).toBe(false)
  })
})

describe("partner team workload", () => {
  const dash = derivePracticeDashboard(input())

  it("counts assigned effective clients, not portfolio-wide access", () => {
    const partner = dash.team.find((row) => row.user_id === PARTNER)
    const senior = dash.team.find((row) => row.user_id === SENIOR)
    const junior = dash.team.find((row) => row.user_id === JUNIOR)
    expect(partner?.assigned_clients).toBe(0)
    expect(senior?.assigned_clients).toBe(1)
    expect(junior?.assigned_clients).toBe(2)
  })

  it("attributes staff Work only via assigned_user_id", () => {
    const senior = dash.team.find((row) => row.user_id === SENIOR)
    const junior = dash.team.find((row) => row.user_id === JUNIOR)
    expect(senior?.open_work).toBe(2)
    expect(senior?.overdue).toBe(1)
    expect(junior?.open_work).toBe(1)
    expect(junior?.overdue).toBe(0)
  })

  it("does not attribute unassigned work to staff", () => {
    const attributed = dash.team.reduce((sum, row) => sum + row.open_work, 0)
    expect(attributed).toBe(3)
    expect(dash.unassigned.open_work).toBe(3)
    expect(dash.unassigned.assignable).toBe(1)
    expect(dash.unassigned.without_owner).toBe(2)
  })

  it("does not include another firm's staff", () => {
    expect(dash.team.some((row) => row.user_id === FIRM_B_PARTNER)).toBe(false)
  })

  it("shows partner panels and no utilization fields", () => {
    expect(dash.show.team).toBe(true)
    expect(dash.show.coverage).toBe(true)
    expect(JSON.stringify(dash)).not.toMatch(/utiliz|capacity|productivity|efficiency|performance/i)
  })
})

describe("client attention", () => {
  const dash = derivePracticeDashboard(input())

  it("sorts clients by overdue, then due today, then open work", () => {
    expect(dash.clients_at_risk.map((row) => row.business_id)).toEqual([CLIENT_1, CLIENT_2])
    expect(dash.clients_at_risk[0].overdue).toBe(1)
    expect(dash.clients_at_risk[0].due_today).toBe(1)
    expect(dash.clients_at_risk[1].overdue).toBe(1)
    expect(dash.clients_at_risk[1].due_today).toBe(0)
  })

  it("excludes a client with no active work", () => {
    expect(dash.clients_at_risk.some((row) => row.business_id === "biz-clear")).toBe(false)
  })

  it("excludes a suspended engagement client", () => {
    expect(dash.summary.clients).not.toBeGreaterThan(2)
    expect(dash.clients_at_risk.some((row) => row.business_id === CLIENT_3_SUSPENDED)).toBe(false)
    expect(dash.needs_attention.some((item) => item.business_id === CLIENT_3_SUSPENDED)).toBe(false)
  })

  it("excludes a foreign client", () => {
    expect(dash.clients_at_risk.some((row) => row.business_id === CLIENT_B)).toBe(false)
    expect(dash.needs_attention.some((item) => item.business_id === CLIENT_B)).toBe(false)
  })
})

describe("role and assignment scope", () => {
  it("lets a partner see the full active firm", () => {
    const dash = derivePracticeDashboard(input())
    expect(dash.summary.clients).toBe(2)
    expect(dash.show.team).toBe(true)
    expect(dash.team).toHaveLength(4)
  })

  it("scopes a senior dashboard to assigned clients when enforcement is on", () => {
    const dash = derivePracticeDashboard(
      input({
        role: "senior",
        currentUserId: SENIOR,
        authorizedBusinessIds: [CLIENT_1],
        clients: [{ id: CLIENT_1, name: "ABC Ltd" }],
      })
    )
    expect(dash.summary.clients).toBe(1)
    expect(dash.show.team).toBe(false)
    expect(dash.team).toEqual([])
    expect(dash.clients_at_risk.every((row) => row.business_id === CLIENT_1)).toBe(true)
    expect(dash.summary.my_work).toBe(2)
  })

  it("scopes a junior dashboard to assigned clients", () => {
    const dash = derivePracticeDashboard(
      input({
        role: "junior",
        currentUserId: JUNIOR,
        authorizedBusinessIds: [CLIENT_1, CLIENT_2],
      })
    )
    expect(dash.summary.clients).toBe(2)
    expect(dash.show.team).toBe(false)
    expect(dash.show.review).toBe(false)
    expect(dash.summary.my_work).toBe(1)
  })

  it("scopes a readonly dashboard", () => {
    const dash = derivePracticeDashboard(
      input({
        role: "readonly",
        currentUserId: READONLY,
        authorizedBusinessIds: [CLIENT_2],
        clients: [{ id: CLIENT_2, name: "BuildCo" }],
      })
    )
    expect(dash.summary.clients).toBe(1)
    expect(dash.clients_at_risk.every((row) => row.business_id === CLIENT_2)).toBe(true)
    expect(dash.show.review).toBe(false)
  })

  it("uses legacy assignment mode: restricted roles see all effective clients", () => {
    const dash = derivePracticeDashboard(
      input({
        role: "senior",
        currentUserId: SENIOR,
        enforcementActive: false,
        authorizedBusinessIds: [CLIENT_1, CLIENT_2],
      })
    )
    expect(dash.summary.clients).toBe(2)
    expect(dash.show.team).toBe(false)
    expect(dash.coverage).toEqual({ enforcement_active: false })
  })
})

describe("coverage and review", () => {
  it("surfaces assignment gaps only when enforcement is on", () => {
    const on = derivePracticeDashboard(input())
    expect(on.coverage).toEqual({
      enforcement_active: true,
      effective_clients: 2,
      with_staff: 2,
      without_staff: 0,
    })

    const gap = derivePracticeDashboard(
      input({
        effectiveBusinessIds: [CLIENT_1, CLIENT_2, "biz-gap"],
        assignments: [{ user_id: SENIOR, client_business_id: CLIENT_1 }],
      })
    )
    expect(gap.coverage).toEqual({
      enforcement_active: true,
      effective_clients: 3,
      with_staff: 1,
      without_staff: 2,
    })
  })

  it("counts existing journal/OB review work without creating a new system", () => {
    const dash = derivePracticeDashboard(input())
    expect(dash.review.count).toBe(1)
    expect(dash.review.items[0].source).toBe("journal_approval")
  })
})

describe("active firm isolation in the read model", () => {
  it("Firm A metrics do not include Firm B", () => {
    const dash = derivePracticeDashboard(input())
    expect(dash.firm_id).toBe(FIRM_A)
    expect(dash.summary.open_work).toBe(6)
    expect(JSON.stringify(dash)).not.toContain(CLIENT_B)
    expect(JSON.stringify(dash)).not.toContain(FIRM_B)
  })

  it("switching firm switches metrics", () => {
    const firmB = derivePracticeDashboard({
      firmId: FIRM_B,
      role: "partner",
      currentUserId: FIRM_B_PARTNER,
      enforcementActive: false,
      authorizedBusinessIds: [CLIENT_B],
      effectiveBusinessIds: [CLIENT_B],
      clients: [{ id: CLIENT_B, name: "Firm B Client" }],
      staff: [{ user_id: FIRM_B_PARTNER, name: "Partner B", role: "partner" }],
      assignments: [],
      items: portfolioItems,
    })
    expect(firmB.firm_id).toBe(FIRM_B)
    expect(firmB.summary.clients).toBe(1)
    expect(firmB.summary.open_work).toBe(1)
    expect(firmB.clients_at_risk[0]?.business_id).toBe(CLIENT_B)
    expect(firmB.team.every((row) => row.user_id !== PARTNER)).toBe(true)
  })
})
