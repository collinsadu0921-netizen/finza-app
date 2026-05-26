import {
  extractRawInvoiceTaxLinesForEvat,
  mapInvoiceToEvatDraft,
  type EvatDraftInvoiceInput,
} from "../mapInvoiceToEvatDraft"

function baseInvoice(overrides: Partial<EvatDraftInvoiceInput> = {}): EvatDraftInvoiceInput {
  return {
    id: "inv-1",
    invoice_number: "INV-001",
    issue_date: "2026-05-01",
    currency: "GHS",
    subtotal: 100,
    total_tax: 21.9,
    total: 121.9,
    tax_lines: {
      lines: [
        {
          code: "NHIL",
          amount: 2.5,
          name: "NHIL",
          meta: { gra_field_name: "levyAmountA", gra_levy_slot: "A", tax_schedule_line_id: "nhil-row" },
        },
        {
          code: "GETFUND",
          amount: 2.5,
          name: "GETFund",
          meta: { gra_field_name: "levyAmountB", gra_levy_slot: "B", tax_schedule_line_id: "gf-row" },
        },
        {
          code: "COVID",
          amount: 1,
          name: "COVID",
          meta: { gra_field_name: "levyAmountC", gra_levy_slot: "C", tax_schedule_line_id: "cov-row" },
        },
        {
          code: "VAT",
          amount: 15.9,
          name: "VAT",
          meta: { gra_field_name: "invoiceVat", tax_schedule_line_id: "vat-row" },
        },
      ],
      meta: {},
      pricing_mode: "inclusive",
    },
    seller: {
      business_id: "biz-1",
      name: "Acme Ltd",
      tin: "C000111222",
      country: "GH",
    },
    buyer: {
      name: "Kwame Customer",
      tin: "C000333444",
    },
    items: [
      {
        id: "li-1",
        sku: "SKU-99",
        description: "Consulting",
        quantity: 1,
        unit_price: 121.9,
        line_total: 121.9,
        gra_item_category: "STANDARD",
      },
    ],
    enrollment: { enrollment_status: "approved" },
    ...overrides,
  }
}

describe("mapInvoiceToEvatDraft", () => {
  it("approved + complete draft => submittable true, blockingIssues empty", () => {
    const d = mapInvoiceToEvatDraft(baseInvoice())
    expect(d.submittable).toBe(true)
    expect(d.blockingIssues).toEqual([])
    expect(d.warnings).not.toContain("tax_total_mismatch")
    expect(d.warnings).not.toContain("evat_not_approved")
    expect(d.taxes.levies).toHaveLength(3)
    expect(d.taxes.vat).toHaveLength(1)
    expect(d.taxes.totalTax).toBe(21.9)
    expect(d.totals.taxDifference).toBe(0)
  })

  it("approved + missing seller TIN => submittable false, blockingIssues includes missing_seller_tin", () => {
    const d = mapInvoiceToEvatDraft(
      baseInvoice({
        seller: { business_id: "biz-1", name: "X", tin: null, tax_id: null },
      })
    )
    expect(d.submittable).toBe(false)
    expect(d.warnings).toContain("missing_seller_tin")
    expect(d.blockingIssues).toContain("missing_seller_tin")
    expect(d.blockingIssues).toEqual(["missing_seller_tin"])
  })

  it("missing enrollment => submittable false, blockingIssues includes evat_not_approved", () => {
    const d = mapInvoiceToEvatDraft(baseInvoice({ enrollment: undefined }))
    expect(d.submittable).toBe(false)
    expect(d.warnings).toContain("evat_not_approved")
    expect(d.blockingIssues).toContain("evat_not_approved")
    expect(d.blockingIssues).toEqual(["evat_not_approved"])
  })

  it("tax mismatch => submittable false, blockingIssues includes tax_total_mismatch", () => {
    const d = mapInvoiceToEvatDraft(baseInvoice({ total_tax: 999 }))
    expect(d.warnings).toContain("tax_total_mismatch")
    expect(d.blockingIssues).toContain("tax_total_mismatch")
    expect(d.submittable).toBe(false)
  })

  it("missing buyer TIN => warning only, not blocking", () => {
    const d = mapInvoiceToEvatDraft(
      baseInvoice({
        buyer: { name: "Y", tin: null, tax_id: null },
      })
    )
    expect(d.warnings).toContain("missing_buyer_tin")
    expect(d.blockingIssues).not.toContain("missing_buyer_tin")
    expect(d.blockingIssues).toEqual([])
    expect(d.submittable).toBe(true)
  })

  it("missing item category/code => warning only, not blocking", () => {
    const d = mapInvoiceToEvatDraft(
      baseInvoice({
        items: [
          {
            id: "   ",
            sku: null,
            description: "Thing",
            quantity: 1,
            unit_price: 10,
            line_total: 10,
          },
        ],
      })
    )
    expect(d.warnings).toContain("missing_item_code")
    expect(d.warnings).toContain("missing_item_category")
    expect(d.blockingIssues).toEqual([])
    expect(d.submittable).toBe(true)
  })

  it("missing VAT schedule metadata => warning only, not blocking", () => {
    const d = mapInvoiceToEvatDraft(
      baseInvoice({
        tax_lines: {
          lines: [
            {
              code: "VAT",
              amount: 10,
              meta: {},
            },
          ],
          pricing_mode: "inclusive",
        },
        total_tax: 10,
        total: 110,
        subtotal: 100,
      })
    )
    expect(d.taxes.vat).toHaveLength(1)
    expect(d.warnings).toContain("missing_vat_schedule_metadata")
    expect(d.blockingIssues).toEqual([])
    expect(d.submittable).toBe(true)
  })

  it("canonical NHIL/GETFund/COVID with metadata maps to levy buckets", () => {
    const d = mapInvoiceToEvatDraft(baseInvoice())
    const codes = d.taxes.levies.map((l) => l.code.toUpperCase()).sort()
    expect(codes).toEqual(["COVID", "GETFUND", "NHIL"])
    expect(d.taxes.levies.every((l) => l.meta.gra_field_name)).toBe(true)
  })

  it("legacy tax_lines shape maps correctly", () => {
    const d = mapInvoiceToEvatDraft(
      baseInvoice({
        tax_lines: {
          tax_lines: [
            { code: "NHIL", amount: 1, meta: { gra_field_name: "levyAmountA" } },
            { code: "VAT", amount: 5, meta: { tax_schedule_line_id: "x" } },
          ],
          tax_total: 6,
          subtotal_excl_tax: 94,
          total_incl_tax: 100,
        },
        total_tax: 6,
      })
    )
    expect(d.taxes.levies).toHaveLength(1)
    expect(d.taxes.vat).toHaveLength(1)
    expect(d.taxes.totalTax).toBe(6)
  })

  it("root array tax_lines shape maps correctly", () => {
    const d = mapInvoiceToEvatDraft(
      baseInvoice({
        tax_lines: [{ code: "CST", amount: 3, meta: { gra_field_name: "levyAmountD" } }],
        total_tax: 3,
        total: 103,
        subtotal: 100,
      })
    )
    expect(d.taxes.levies).toHaveLength(1)
    expect(d.taxes.levies[0].code).toBe("CST")
    expect(d.taxes.totalTax).toBe(3)
  })

  it("missing seller or buyer TIN both appear in warnings when both absent", () => {
    const d = mapInvoiceToEvatDraft(
      baseInvoice({
        seller: { business_id: "biz-1", name: "X", tin: null, tax_id: null },
        buyer: { name: "Y", tin: null, tax_id: null },
      })
    )
    expect(d.warnings).toContain("missing_seller_tin")
    expect(d.warnings).toContain("missing_buyer_tin")
    expect(d.blockingIssues).toContain("missing_seller_tin")
    expect(d.blockingIssues).not.toContain("missing_buyer_tin")
  })

  it("internal item code fallback order sku > code > product_id > id", () => {
    const base = baseInvoice({ items: [] })
    const withSku = mapInvoiceToEvatDraft({
      ...base,
      items: [
        {
          id: "i1",
          sku: "S1",
          product_id: "P1",
          description: "A",
          quantity: 1,
          unit_price: 1,
          line_total: 1,
          gra_item_category: "X",
        },
      ],
    })
    expect(withSku.items[0].internalItemCode).toBe("S1")

    const withCode = mapInvoiceToEvatDraft({
      ...base,
      items: [
        {
          id: "i1",
          code: "C1",
          product_id: "P1",
          description: "A",
          quantity: 1,
          unit_price: 1,
          line_total: 1,
          gra_item_category: "X",
        },
      ],
    })
    expect(withCode.items[0].internalItemCode).toBe("C1")

    const withPid = mapInvoiceToEvatDraft({
      ...base,
      items: [
        {
          id: "i1",
          product_id: "P9",
          description: "A",
          quantity: 1,
          unit_price: 1,
          line_total: 1,
          gra_item_category: "X",
        },
      ],
    })
    expect(withPid.items[0].internalItemCode).toBe("P9")

    const withIdOnly = mapInvoiceToEvatDraft({
      ...base,
      items: [
        {
          id: "only-id",
          description: "A",
          quantity: 1,
          unit_price: 1,
          line_total: 1,
          gra_item_category: "X",
        },
      ],
    })
    expect(withIdOnly.items[0].internalItemCode).toBe("only-id")

    const empty = mapInvoiceToEvatDraft({
      ...base,
      items: [
        {
          id: "   ",
          description: "A",
          quantity: 1,
          unit_price: 1,
          line_total: 1,
          gra_item_category: "X",
        },
      ],
    })
    expect(empty.items[0].internalItemCode).toBe(null)
    expect(empty.warnings).toContain("missing_item_code")
    expect(empty.blockingIssues).toEqual([])
    expect(empty.submittable).toBe(true)
  })

  it("missing_item_category when no gra_item_category or product_tax_category", () => {
    const d = mapInvoiceToEvatDraft(
      baseInvoice({
        items: [
          {
            id: "li-1",
            sku: "S",
            description: "Thing",
            quantity: 1,
            unit_price: 10,
            line_total: 10,
          },
        ],
      })
    )
    expect(d.warnings).toContain("missing_item_category")
    expect(d.blockingIssues).toEqual([])
    expect(d.submittable).toBe(true)
  })

  it("product_tax_category supplies display category when gra omitted", () => {
    const d = mapInvoiceToEvatDraft(
      baseInvoice({
        items: [
          {
            id: "li-1",
            sku: "S",
            description: "Thing",
            quantity: 1,
            unit_price: 10,
            line_total: 10,
            product_tax_category: { code: "STANDARD", name: "Standard rate" },
          },
        ],
      })
    )
    expect(d.warnings).not.toContain("missing_item_category")
    expect(d.blockingIssues).toEqual([])
    expect(d.items[0].product_tax_category).toBe("STANDARD")
    expect(d.items[0].gra_item_category).toBe(null)
  })

  it("totals use stored line amounts, not recomputed from invoice gross", () => {
    const lines = [
      { code: "NHIL", amount: 2.5, meta: { gra_field_name: "levyAmountA" } },
      { code: "VAT", amount: 15.9, meta: { tax_schedule_line_id: "v1" } },
    ]
    const d = mapInvoiceToEvatDraft(
      baseInvoice({
        tax_lines: { lines, pricing_mode: "inclusive" },
        total_tax: 18.4,
        total: 500,
        subtotal: 1,
      })
    )
    const sumStored = lines.reduce((s, x: { amount: number }) => s + x.amount, 0)
    expect(d.taxes.totalTax).toBe(round2(sumStored))
    expect(d.totals.mappedTotalTax).toBe(18.4)
    expect(d.totals.invoiceTotal).toBe(500)
    expect(d.totals.subtotal).toBe(1)
  })

  it("levy without gra_field_name adds warning", () => {
    const d = mapInvoiceToEvatDraft(
      baseInvoice({
        tax_lines: {
          lines: [{ code: "NHIL", amount: 1, meta: {} }],
          pricing_mode: "inclusive",
        },
        total_tax: 1,
        total: 101,
        subtotal: 100,
      })
    )
    expect(d.warnings).toContain("missing_gra_field_name_for_levy")
    expect(d.blockingIssues).toEqual([])
    expect(d.submittable).toBe(true)
  })

  it("unclassified tax line warns and blocks submittable", () => {
    const d = mapInvoiceToEvatDraft(
      baseInvoice({
        tax_lines: {
          lines: [
            { code: "NHIL", amount: 1, meta: { gra_field_name: "levyAmountA" } },
            { code: "MYSTERIOUS", amount: 2, meta: {} },
          ],
          pricing_mode: "inclusive",
        },
        total_tax: 3,
      })
    )
    expect(d.warnings).toContain("unclassified_tax_line")
    expect(d.blockingIssues).toContain("unclassified_tax_line")
    expect(d.submittable).toBe(false)
    expect(d.taxes.totalTax).toBe(1)
  })
})

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

describe("extractRawInvoiceTaxLinesForEvat", () => {
  it("prefers non-empty canonical lines over nested tax_lines", () => {
    const raw = extractRawInvoiceTaxLinesForEvat({
      lines: [{ code: "VAT", amount: 1 }],
      tax_lines: [{ code: "NHIL", amount: 9 }],
    })
    expect(raw).toHaveLength(1)
    expect(raw[0].code).toBe("VAT")
  })

  it("falls back to nested tax_lines when canonical lines empty", () => {
    const raw = extractRawInvoiceTaxLinesForEvat({
      lines: [],
      tax_lines: [{ code: "NHIL", amount: 2, meta: { gra_field_name: "levyAmountA" } }],
    })
    expect(raw).toHaveLength(1)
    expect(raw[0].code).toBe("NHIL")
  })
})
