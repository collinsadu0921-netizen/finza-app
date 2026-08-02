import {
  clearAccountantFirmUserSessionCache,
  resolveIsAccountantFirmUser,
} from "@/lib/accounting/accountantFirmUserSession"

describe("accountantFirmUserSession", () => {
  beforeEach(() => {
    clearAccountantFirmUserSessionCache()
  })

  it("returns cached result for repeated lookups with the same user", async () => {
    const from = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue({ data: [{ firm_id: "f1" }] }),
        }),
      }),
    })
    const supabase = { from } as never

    const first = await resolveIsAccountantFirmUser(supabase, "user-1")
    const second = await resolveIsAccountantFirmUser(supabase, "user-1")

    expect(first).toBe(true)
    expect(second).toBe(true)
    expect(from).toHaveBeenCalledTimes(1)
  })

  it("re-queries when the authenticated user changes", async () => {
    const from = jest
      .fn()
      .mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue({ data: [{ firm_id: "f1" }] }),
          }),
        }),
      })
      .mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue({ data: [] }),
          }),
        }),
      })

    const supabase = { from } as never

    expect(await resolveIsAccountantFirmUser(supabase, "user-1")).toBe(true)
    expect(await resolveIsAccountantFirmUser(supabase, "user-2")).toBe(false)
    expect(from).toHaveBeenCalledTimes(2)
  })
})
