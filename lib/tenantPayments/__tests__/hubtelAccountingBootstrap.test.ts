import {
  ensureAccountingInitialized,
  ensureAccountingInitializedForServerJob,
} from "@/lib/accountingBootstrap"

describe("accounting bootstrap helpers", () => {
  it("ensureAccountingInitialized calls ensure_accounting_initialized RPC", async () => {
    const rpc = jest.fn().mockResolvedValue({ error: null })
    const supabase = { rpc } as unknown as import("@supabase/supabase-js").SupabaseClient

    const result = await ensureAccountingInitialized(supabase, "biz-1")

    expect(result.initialized).toBe(true)
    expect(rpc).toHaveBeenCalledWith("ensure_accounting_initialized", { p_business_id: "biz-1" })
  })

  it("ensureAccountingInitializedForServerJob calls ensure_accounting_initialized_system RPC", async () => {
    const rpc = jest.fn().mockResolvedValue({ error: null })
    const supabase = { rpc } as unknown as import("@supabase/supabase-js").SupabaseClient

    const result = await ensureAccountingInitializedForServerJob(supabase, "biz-1")

    expect(result.initialized).toBe(true)
    expect(rpc).toHaveBeenCalledWith("ensure_accounting_initialized_system", {
      p_business_id: "biz-1",
    })
  })

  it("user bootstrap returns INIT_DENIED when RPC rejects auth.uid()", async () => {
    const rpc = jest.fn().mockResolvedValue({
      error: { message: "Not allowed to initialize accounting for this business", code: "P0001" },
    })
    const supabase = { rpc } as unknown as import("@supabase/supabase-js").SupabaseClient

    const result = await ensureAccountingInitialized(supabase, "biz-1")

    expect(result.initialized).toBe(false)
    expect(result.structuredError?.error_code).toBe("INIT_DENIED")
  })
})
