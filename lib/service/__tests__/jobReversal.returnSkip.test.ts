/**
 * Unit tests: performServiceJobReversal skips already-returned usages
 */
import { describe, it, expect, jest } from "@jest/globals"
import { performServiceJobReversal } from "../jobReversal"

describe("performServiceJobReversal", () => {
  it("does not restore stock for returned usages", async () => {
    const inventoryUpdates: unknown[] = []
    const movementInserts: unknown[] = []

    const supabase = {
      from: jest.fn((table: string) => {
        if (table === "service_jobs") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: { id: "job-1", materials_reversed: false },
              error: null,
            }),
            update: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockResolvedValue({ error: null }),
              }),
            }),
          }
        }
        if (table === "service_job_material_usage") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            // thenable-ish chain ending
            then: undefined,
            // final await resolves via eq().eq() — mock both eqs returning this then resolve
          }
        }
        if (table === "service_material_inventory") {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: { id: "mat-1", quantity_on_hand: 10 },
              error: null,
            }),
            update: jest.fn((payload: unknown) => {
              inventoryUpdates.push(payload)
              return {
                eq: jest.fn().mockReturnValue({
                  eq: jest.fn().mockResolvedValue({ error: null }),
                }),
              }
            }),
          }
        }
        if (table === "service_material_movements") {
          return {
            insert: jest.fn((payload: unknown) => {
              movementInserts.push(payload)
              return Promise.resolve({ error: null })
            }),
          }
        }
        return {}
      }),
      rpc: jest.fn().mockResolvedValue({ error: null }),
    }

    // Rebuild with proper chained eq for usage fetch
    const usageSelect = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
    }
    ;(usageSelect as { eq: jest.Mock }).eq = jest.fn().mockImplementation(() => usageSelect)
    // Make the chain awaitable: last eq resolves
    let eqCount = 0
    ;(usageSelect as { eq: jest.Mock }).eq = jest.fn().mockImplementation(() => {
      eqCount += 1
      if (eqCount >= 2) {
        return Promise.resolve({
          data: [
            {
              id: "u-returned",
              material_id: "mat-1",
              quantity_used: 5,
              unit_cost: 70,
              total_cost: 350,
              status: "returned",
              return_movement_id: "mov-existing",
            },
            {
              id: "u-active",
              material_id: "mat-1",
              quantity_used: 2,
              unit_cost: 70,
              total_cost: 140,
              status: "allocated",
              return_movement_id: null,
            },
          ],
          error: null,
        })
      }
      return usageSelect
    })

    supabase.from = jest.fn((table: string) => {
      if (table === "service_jobs") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { id: "job-1", materials_reversed: false },
            error: null,
          }),
          update: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          }),
        }
      }
      if (table === "service_job_material_usage") {
        return usageSelect
      }
      if (table === "service_material_inventory") {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { id: "mat-1", quantity_on_hand: 10 },
            error: null,
          }),
          update: jest.fn((payload: unknown) => {
            inventoryUpdates.push(payload)
            return {
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockResolvedValue({ error: null }),
              }),
            }
          }),
        }
      }
      if (table === "service_material_movements") {
        return {
          insert: jest.fn((payload: unknown) => {
            movementInserts.push(payload)
            return Promise.resolve({ error: null })
          }),
        }
      }
      return {}
    }) as never

    const result = await performServiceJobReversal(supabase as never, "biz-1", "job-1")
    expect(result.error).toBeUndefined()
    expect(inventoryUpdates).toHaveLength(1)
    expect((inventoryUpdates[0] as { quantity_on_hand: number }).quantity_on_hand).toBe(12)
    expect(movementInserts).toHaveLength(1)
    expect((movementInserts[0] as { quantity: number }).quantity).toBe(2)
    expect(supabase.rpc).toHaveBeenCalledWith("reverse_service_job_cogs", { p_job_id: "job-1" })
  })
})
