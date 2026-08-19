import { aggregatePracticeWork, workItemDedupeKey } from "../aggregate"
import { filterPracticeWorkItems } from "../filter"
import { classifyUrgency, mapRequestStatusGroup } from "../normalize"
import { controlTowerListRedirectPath } from "../compat"
import { partitionFirmEngagements, resolveWorkFirmId } from "../scope"
import { CLIENT_REQUEST_STATUS_SET } from "../requestStatus"
import type { PracticeWorkItem } from "../types"

const now = new Date("2026-08-19T12:00:00.000Z")

const names = { "biz-abc": "ABC Ltd", "biz-build": "BuildCo", "biz-kofi": "Kofi Services" }
const staff = { "user-ama": "Ama" }

function baseInput() {
  return {
    tasks: [
      {
        id: "task-1",
        client_business_id: "biz-abc",
        title: "Prepare VAT pack",
        status: "pending",
        priority: "high",
        assigned_to_user_id: "user-ama",
        due_at: "2026-08-19T09:00:00.000Z",
        created_at: "2026-08-18T09:00:00.000Z",
      },
      {
        id: "task-other",
        client_business_id: "biz-abc",
        title: "Other user task",
        status: "pending",
        priority: "normal",
        assigned_to_user_id: "user-kojo",
        due_at: "2026-08-21T09:00:00.000Z",
        created_at: "2026-08-18T10:00:00.000Z",
      },
      {
        id: "task-unassigned",
        client_business_id: "biz-abc",
        title: "Unassigned review",
        status: "pending",
        priority: "normal",
        assigned_to_user_id: null,
        due_at: null,
        created_at: "2026-08-18T11:00:00.000Z",
      },
    ],
    requests: [
      {
        id: "req-1",
        client_business_id: "biz-kofi",
        title: "Bank statements requested",
        status: "waiting_on_client",
        due_at: "2026-08-20T09:00:00.000Z",
        created_at: "2026-08-17T09:00:00.000Z",
      },
      {
        id: "req-done",
        client_business_id: "biz-kofi",
        title: "Completed request",
        status: "completed",
        due_at: null,
        created_at: "2026-08-10T09:00:00.000Z",
      },
    ],
    filings: [
      {
        id: "fil-1",
        client_business_id: "biz-abc",
        filing_type: "VAT",
        status: "pending",
        created_at: "2026-08-16T09:00:00.000Z",
      },
    ],
    journalsSubmitted: [
      {
        id: "jnl-1",
        client_business_id: "biz-build",
        status: "submitted",
        submitted_at: "2026-08-18T09:00:00.000Z",
        created_at: "2026-08-18T08:00:00.000Z",
      },
    ],
    journalsApprovedUnposted: [],
    openingBalanceDrafts: [],
    openingBalanceApprovedUnposted: [],
    engagementIssues: [],
    businessNames: names,
    staffNames: staff,
    effectiveBusinessIds: ["biz-abc", "biz-build", "biz-kofi"],
    now,
  }
}

describe("Practice Work aggregation", () => {
  it("includes a task, request, filing, and journal approval", () => {
    const items = aggregatePracticeWork(baseInput())
    expect(items.some((i) => i.source === "task" && i.source_id === "task-1")).toBe(true)
    expect(items.some((i) => i.source === "request" && i.source_id === "req-1")).toBe(true)
    expect(items.some((i) => i.source === "filing" && i.source_id === "fil-1")).toBe(true)
    expect(items.some((i) => i.source === "journal_approval" && i.source_id === "jnl-1")).toBe(true)
  })

  it("does not duplicate the same underlying item", () => {
    const input = baseInput()
    input.journalsSubmitted.push(input.journalsSubmitted[0])
    const items = aggregatePracticeWork(input)
    const keys = items.map((item) => workItemDedupeKey(item))
    expect(new Set(keys).size).toBe(keys.length)
    expect(items.filter((item) => item.source === "journal_approval").length).toBe(1)
  })

  it("does not invent a second journal item from a fake control-tower copy", () => {
    const items = aggregatePracticeWork(baseInput())
    expect(items.filter((item) => item.source_id === "jnl-1").length).toBe(1)
  })

  it("scopes tasks to effective engagements only", () => {
    const input = baseInput()
    input.effectiveBusinessIds = ["biz-build"]
    const items = aggregatePracticeWork(input)
    expect(items.some((i) => i.source === "task")).toBe(false)
    expect(items.some((i) => i.source === "journal_approval")).toBe(true)
  })
})

describe("assignment views", () => {
  function items(): PracticeWorkItem[] {
    return aggregatePracticeWork(baseInput())
  }

  it("My Work contains the assigned task and excludes another user's task", () => {
    const mine = filterPracticeWorkItems(items(), {
      view: "my",
      currentUserId: "user-ama",
    })
    expect(mine.some((i) => i.source_id === "task-1")).toBe(true)
    expect(mine.some((i) => i.source_id === "task-other")).toBe(false)
    expect(mine.some((i) => i.source === "request")).toBe(false)
  })

  it("Unassigned view contains unassigned items and unsupported-assignment sources", () => {
    const unassigned = filterPracticeWorkItems(items(), {
      view: "unassigned",
      currentUserId: "user-ama",
    })
    expect(unassigned.some((i) => i.source_id === "task-unassigned")).toBe(true)
    expect(unassigned.some((i) => i.source === "request")).toBe(true)
    expect(unassigned.some((i) => i.source_id === "task-1")).toBe(false)
  })
})

describe("request waiting_on_client", () => {
  it("is a real persisted status value", () => {
    expect(CLIENT_REQUEST_STATUS_SET.has("waiting_on_client")).toBe(true)
  })

  it("renders as Waiting", () => {
    expect(mapRequestStatusGroup("waiting_on_client")).toBe("waiting")
  })

  it("excludes completed from default active work", () => {
    const items = filterPracticeWorkItems(aggregatePracticeWork(baseInput()), {
      view: "all",
      currentUserId: "user-ama",
    })
    expect(items.some((i) => i.source_id === "req-done")).toBe(false)
    expect(items.some((i) => i.source_id === "req-1")).toBe(true)
  })
})

describe("due-date classification", () => {
  it("classifies overdue, today, and next 7 days", () => {
    expect(classifyUrgency("2026-08-18T23:00:00.000Z", now)).toBe("overdue")
    expect(classifyUrgency("2026-08-19T18:00:00.000Z", now)).toBe("today")
    expect(classifyUrgency("2026-08-24T12:00:00.000Z", now)).toBe("soon")
    expect(classifyUrgency("2026-09-01T12:00:00.000Z", now)).toBe("later")
    expect(classifyUrgency(null, now)).toBe("none")
  })
})

describe("firm isolation helpers", () => {
  it("rejects a firm the user does not belong to", () => {
    const resolved = resolveWorkFirmId({
      memberships: [{ firm_id: "firm-a" }],
      requestedFirmId: "firm-b",
    })
    expect(resolved.firmId).toBeNull()
    expect(resolved.reason).toBe("firm_not_member")
  })

  it("does not let a business filter invent another firm's engagements", () => {
    const partitioned = partitionFirmEngagements(
      [
        {
          id: "eng-a",
          accounting_firm_id: "firm-a",
          client_business_id: "biz-a",
          status: "accepted",
          effective_from: "2026-01-01",
          effective_to: null,
        },
      ],
      now
    )
    expect(partitioned.effectiveBusinessIds).toEqual(["biz-a"])
    expect(partitioned.issues).toEqual([])
  })
})

describe("control tower compatibility", () => {
  it("redirects the list route and preserves business_id as client filter", () => {
    expect(controlTowerListRedirectPath({})).toBe("/accounting/work")
    expect(controlTowerListRedirectPath({ business_id: "biz-abc" })).toBe(
      "/accounting/work?client=biz-abc"
    )
  })
})
