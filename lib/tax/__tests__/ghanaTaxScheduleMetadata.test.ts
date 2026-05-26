import type { TaxLine } from "@/lib/taxEngine/types"
import type { TaxResult } from "@/lib/taxEngine/types"
import {
  enrichGhanaTaxLinesWithScheduleMetadata,
  enrichGhanaTaxResultWithScheduleMetadata,
} from "../ghanaTaxScheduleMetadata"
import type { GhanaScheduleLineMeta } from "../ghanaTaxScheduleMetadata"

function sampleMeta(ref: Partial<GhanaScheduleLineMeta>): GhanaScheduleLineMeta {
  return {
    tax_schedule_id: "sched-1",
    tax_schedule_code: "GH_EVAT_LEVY_MAP_V8_2",
    tax_schedule_line_id: "line-1",
    gra_field_name: "levyAmountA",
    gra_levy_slot: "A",
    classification: "levy",
    ...ref,
  }
}

describe("ghanaTaxScheduleMetadata", () => {
  describe("enrichGhanaTaxLinesWithScheduleMetadata", () => {
    it("returns same reference when map is null", () => {
      const lines: TaxLine[] = [{ code: "NHIL", amount: 1 }]
      const out = enrichGhanaTaxLinesWithScheduleMetadata(lines, null)
      expect(out).toBe(lines)
    })

    it("merges schedule meta for matching codes only", () => {
      const lines: TaxLine[] = [
        { code: "NHIL", amount: 2.5, meta: { base: 100 } },
        { code: "VAT", amount: 10, meta: {} },
      ]
      const map = new Map<string, GhanaScheduleLineMeta>([
        ["NHIL", sampleMeta({ tax_schedule_line_id: "nhil-row", gra_field_name: "levyAmountA", gra_levy_slot: "A" })],
      ])
      const out = enrichGhanaTaxLinesWithScheduleMetadata(lines, map)
      expect(out).not.toBe(lines)
      expect(out[0].amount).toBe(2.5)
      expect(out[0].code).toBe("NHIL")
      expect(out[0].meta?.base).toBe(100)
      expect(out[0].meta?.tax_schedule_id).toBe("sched-1")
      expect(out[0].meta?.gra_field_name).toBe("levyAmountA")
      expect(out[1].meta?.tax_schedule_id).toBeUndefined()
    })

    it("matches codes case-insensitively", () => {
      const lines: TaxLine[] = [{ code: "nhil", amount: 1 }]
      const map = new Map<string, GhanaScheduleLineMeta>([
        ["NHIL", sampleMeta({ tax_schedule_line_id: "x" })],
      ])
      const out = enrichGhanaTaxLinesWithScheduleMetadata(lines, map)
      expect(out[0].meta?.tax_schedule_line_id).toBe("x")
    })
  })

  describe("enrichGhanaTaxResultWithScheduleMetadata", () => {
    const baseResult: TaxResult = {
      base_amount: 100,
      total_tax: 20,
      total_amount: 120,
      pricing_mode: "inclusive",
      lines: [{ code: "NHIL", amount: 2.5 }],
      meta: {
        jurisdiction: "GH",
        effective_date_used: "2025-01-01",
        engine_version: "GH-2025-A",
      },
    }

    it("returns same result when jurisdiction is not GH", () => {
      const ng: TaxResult = {
        ...baseResult,
        meta: { ...baseResult.meta, jurisdiction: "NG" },
      }
      const map = new Map([["NHIL", sampleMeta({})]])
      expect(enrichGhanaTaxResultWithScheduleMetadata(ng, map)).toBe(ng)
    })

    it("returns same result when map is null", () => {
      expect(enrichGhanaTaxResultWithScheduleMetadata(baseResult, null)).toBe(baseResult)
    })

    it("enrich lines for GH when map has entries", () => {
      const map = new Map([["NHIL", sampleMeta({ tax_schedule_line_id: "row-nhil" })]])
      const out = enrichGhanaTaxResultWithScheduleMetadata(baseResult, map)
      expect(out).not.toBe(baseResult)
      expect(out.lines[0].meta?.tax_schedule_line_id).toBe("row-nhil")
      expect(out.base_amount).toBe(baseResult.base_amount)
      expect(out.total_tax).toBe(baseResult.total_tax)
      expect(out.total_amount).toBe(baseResult.total_amount)
    })
  })
})
