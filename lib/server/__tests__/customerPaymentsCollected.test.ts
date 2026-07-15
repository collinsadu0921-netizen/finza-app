import { loadCustomerPaymentsCollectedTotal } from "@/lib/server/customerPaymentsCollected"

function mockPaymentsQuery(amounts: number[]) {
  const terminal = {
    data: amounts.map((amount) => ({ amount })),
    error: null as null,
  }
  const chain: Record<string, jest.Mock> = {}
  chain.eq = jest.fn(() => chain)
  chain.is = jest.fn(() => chain)
  chain.gte = jest.fn(() => chain)
  chain.lte = jest.fn(() => chain)
  chain.select = jest.fn(() => chain)
  Object.assign(chain, {
    then: (resolve: (v: typeof terminal) => void) => resolve(terminal),
  })
  return {
    from: jest.fn(() => chain),
  }
}

describe("loadCustomerPaymentsCollectedTotal", () => {
  it("sums operational payment amounts in the inclusive date range", async () => {
    const supabase = mockPaymentsQuery([4913, 5000]) as any
    const total = await loadCustomerPaymentsCollectedTotal(
      supabase,
      "biz-a",
      "2026-07-01",
      "2026-07-31"
    )
    expect(total).toBe(9913)
    expect(supabase.from).toHaveBeenCalledWith("payments")
  })

  it("returns 0 on read failure when throwOnError is false", async () => {
    const chain: Record<string, jest.Mock> = {}
    chain.eq = jest.fn(() => chain)
    chain.is = jest.fn(() => chain)
    chain.gte = jest.fn(() => chain)
    chain.lte = jest.fn(() => chain)
    chain.select = jest.fn(() => chain)
    Object.assign(chain, {
      then: (resolve: (v: { data: null; error: { message: string } }) => void) =>
        resolve({ data: null, error: { message: "boom" } }),
    })
    const supabase = { from: jest.fn(() => chain) } as any

    await expect(
      loadCustomerPaymentsCollectedTotal(supabase, "biz-a", "2026-07-01", "2026-07-31")
    ).rejects.toMatchObject({ message: "boom" })

    const soft = await loadCustomerPaymentsCollectedTotal(
      supabase,
      "biz-a",
      "2026-07-01",
      "2026-07-31",
      { throwOnError: false }
    )
    expect(soft).toBe(0)
  })
})
