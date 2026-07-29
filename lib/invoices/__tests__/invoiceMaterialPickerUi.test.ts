import {
  buildBillableMaterialsListUrl,
  interpretBillableMaterialsResponse,
  materialsPickerButtonDisabled,
  materialsPickerButtonLabel,
  serviceMaterialsSetupHref,
} from "../invoiceMaterialPickerUi"

describe("invoiceMaterialPickerUi", () => {
  const biz = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

  it("builds list URL with selected business_id", () => {
    expect(buildBillableMaterialsListUrl(biz)).toBe(
      `/api/service/materials/billable-list?business_id=${biz}`
    )
  })

  it("interprets successful materials as ready", () => {
    const r = interpretBillableMaterialsResponse({
      status: 200,
      requestedBusinessId: biz,
      body: {
        materials: [
          {
            id: "m1",
            name: "Paint",
            description: "Paint",
            unit: "ea",
            sellingPrice: 10,
            taxCode: null,
            quantityAvailable: 1,
          },
        ],
        businessId: biz,
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.state).toBe("ready")
      expect(r.materials).toHaveLength(1)
    }
  })

  it("interprets TIER_REQUIRED as tier-blocked with upgrade copy", () => {
    const r = interpretBillableMaterialsResponse({
      status: 403,
      requestedBusinessId: biz,
      body: { error: "Forbidden", code: "TIER_REQUIRED" },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.state).toBe("tier-blocked")
      expect(r.message).toMatch(/Professional plan/i)
    }
  })

  it("interprets empty 200 as empty setup guidance state", () => {
    const r = interpretBillableMaterialsResponse({
      status: 200,
      requestedBusinessId: biz,
      body: { materials: [], businessId: biz },
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.state).toBe("empty")
  })

  it("does not treat API failure as a valid empty list", () => {
    const r = interpretBillableMaterialsResponse({
      status: 500,
      requestedBusinessId: biz,
      body: { error: "boom", code: "MATERIAL_LIST_FAILED" },
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.state).toBe("error")
      expect(r.materials).toEqual([])
    }
  })

  it("disables Add material outside ready state", () => {
    expect(materialsPickerButtonDisabled("ready")).toBe(false)
    expect(materialsPickerButtonDisabled("loading")).toBe(true)
    expect(materialsPickerButtonDisabled("error")).toBe(true)
    expect(materialsPickerButtonDisabled("empty")).toBe(true)
    expect(materialsPickerButtonLabel("loading")).toMatch(/Loading/i)
  })

  it("links Materials setup with business_id", () => {
    expect(serviceMaterialsSetupHref(biz)).toContain(`business_id=${biz}`)
  })
})
