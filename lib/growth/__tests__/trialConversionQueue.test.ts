import { beforeEach, describe, expect, it, jest } from "@jest/globals"
import { buildTrialConversionQueue } from "../trialConversionQueue"

function queryResult(data: unknown[]) {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  builder.select = chain
  builder.eq = chain
  builder.is = chain
  builder.order = chain
  builder.limit = chain
  builder.gte = chain
  builder.lte = chain
  builder.or = chain
  builder.in = jest.fn(async () => ({ data: [], error: null }))
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data, error: null }))
  return builder
}

describe("buildTrialConversionQueue", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("loads businesses once and activation events once, with no Auth Admin lookup", async () => {
    const authAdmin = jest.fn()
    const businesses = queryResult([
      {
        id: "b1",
        name: "Ada Repairs",
        email: "ada@example.com",
        phone: "0240000000",
        subscription_started_at: null,
        service_subscription_status: "trialing",
        trial_contact_consent: true,
      },
      {
        id: "b2",
        name: "Kojo Shop",
        email: null,
        subscription_started_at: null,
        service_subscription_status: "trialing",
      },
    ])
    const events = queryResult([])
    const from = jest.fn((table: string) => (table === "businesses" ? businesses : events))
    const supabase = { from, auth: { admin: { getUserById: authAdmin } } }

    const page = await buildTrialConversionQueue(supabase as never, { limit: 25, page: 1, filter: "all_unpaid" })

    expect(from).toHaveBeenCalledTimes(2)
    expect(authAdmin).not.toHaveBeenCalled()
    expect(page.meta.auth_admin_calls).toBe(0)
    expect(page.meta.activation_event_query_count).toBe(1)
    expect(page.rows).toHaveLength(2)
    expect(page.rows[1].owner_email).toBeNull()
    expect(page.rows[0].owner_email).toBe("ada@example.com")
  })

  it("paginates after filtering instead of issuing one query per row", async () => {
    const rows = Array.from({ length: 3 }, (_, index) => ({
      id: `b${index}`,
      name: `Biz ${index}`,
      email: `b${index}@example.com`,
      subscription_started_at: null,
      service_subscription_status: "trialing",
    }))
    const businesses = queryResult(rows)
    const events = queryResult([])
    const supabase = { from: jest.fn((table: string) => (table === "businesses" ? businesses : events)) }
    const page = await buildTrialConversionQueue(supabase as never, { limit: 2, page: 2, filter: "all_unpaid" })
    expect(page.rows).toHaveLength(1)
    expect(page.total).toBe(3)
    expect(page.meta.page).toBe(2)
    expect(supabase.from).toHaveBeenCalledTimes(2)
  })
})
