import {
  formatRetailReceiptAddressBlock,
  formatRetailReceiptAddressLines,
  pickRetailReceiptBusinessEmail,
  pickRetailReceiptBusinessPhone,
  wrapRetailReceiptMultiline,
  wrapRetailReceiptTextLine,
} from "@/lib/retail/receipts/retailReceiptBusinessIdentity"
import { mapRetailReceiptApiToEscpos, type RetailReceiptApiBody } from "@/app/retail/lib/mapRetailReceiptApiToEscpos"
import { ESCPOSGenerator, generateReceiptHTML } from "@/lib/escpos"
import { readFileSync } from "fs"
import { join } from "path"

const repoRoot = join(__dirname, "../../../..")

describe("retailReceiptBusinessIdentity", () => {
  it("formats address from stored fields only and skips empties", () => {
    expect(
      formatRetailReceiptAddressLines({
        address_street: " 12 High St ",
        address_city: "Accra",
        address_region: "Greater Accra",
        address_country: "Ghana",
        phone: "",
        email: null,
      })
    ).toEqual(["12 High St", "Accra, Greater Accra", "Ghana"])
    expect(formatRetailReceiptAddressBlock({ address_street: "   ", address_city: null })).toBeUndefined()
  })

  it("picks phone/email without inventing values", () => {
    expect(pickRetailReceiptBusinessPhone({ phone: "055111", whatsapp_phone: "055222" })).toBe("055111")
    expect(pickRetailReceiptBusinessPhone({ phone: "", whatsapp_phone: "055222" })).toBe("055222")
    expect(pickRetailReceiptBusinessPhone({})).toBeUndefined()
    expect(pickRetailReceiptBusinessEmail({ email: " a@b.com " })).toBe("a@b.com")
    expect(pickRetailReceiptBusinessEmail({ email: "  " })).toBeUndefined()
  })

  it("wraps long footer lines for 58mm width", () => {
    const long =
      "Please keep this receipt for your records and contact us within seven days for returns under our shop policy."
    const wrapped = wrapRetailReceiptTextLine(long, 32)
    expect(wrapped.length).toBeGreaterThan(1)
    expect(wrapped.every((l) => l.length <= 32)).toBe(true)
    expect(wrapRetailReceiptMultiline("Line one\n\nLine two that is quite long for thermal", 32).length).toBeGreaterThan(
      2
    )
  })
})

describe("retail receipt branding mapping", () => {
  function body(overrides: Partial<RetailReceiptApiBody> = {}): RetailReceiptApiBody {
    return {
      sale: {
        id: "550e8400-e29b-41d4-a716-446655440000",
        amount: 10,
        created_at: "2026-09-15T12:00:00.000Z",
        payment_method: "cash",
      },
      sale_items: [{ product_name: "Item", quantity: 1, unit_price: 10, line_total: 10 }],
      business: {
        name: "Acme Retail",
        trading_name: "Acme Shop",
        logo_url: "https://cdn.example.com/acme.png",
        address_street: "12 High St",
        address_city: "Accra",
        address_region: null,
        address_country: "Ghana",
        phone: "055100200",
        email: "shop@acme.test",
      },
      store: null,
      ...overrides,
    }
  }

  it("maps tenant identity and logo without Finza substitution", () => {
    const data = mapRetailReceiptApiToEscpos(body(), "GHS", "₵")
    expect(data.businessName).toBe("Acme Shop")
    expect(data.logo).toBe("https://cdn.example.com/acme.png")
    expect(data.businessLocation).toBe("12 High St\nAccra\nGhana")
    expect(data.businessPhone).toBe("055100200")
    expect(data.businessEmail).toBe("shop@acme.test")
    expect(data.logo).not.toMatch(/finza/i)
  })

  it("omits missing identity fields instead of inventing them", () => {
    const data = mapRetailReceiptApiToEscpos(
      body({
        business: { name: "Bare Biz", logo_url: null },
      }),
      "GHS",
      "₵"
    )
    expect(data.businessLocation).toBeUndefined()
    expect(data.businessPhone).toBeUndefined()
    expect(data.businessEmail).toBeUndefined()
    expect(data.logo).toBeUndefined()
  })

  it("prefers store logo and can fall back to store location/contact", () => {
    const data = mapRetailReceiptApiToEscpos(
      body({
        business: { name: "Biz", logo_url: "https://cdn.example.com/biz.png" },
        store: {
          name: "Branch A",
          logo_url: "https://cdn.example.com/branch.png",
          location: "Mall Unit 4",
          phone: "030111",
          email: "branch@acme.test",
        },
      }),
      "GHS",
      "₵"
    )
    expect(data.logo).toBe("https://cdn.example.com/branch.png")
    expect(data.storeName).toBe("Branch A")
    // Business address empty → store location used
    expect(data.businessLocation).toBe("Mall Unit 4")
    expect(data.businessPhone).toBe("030111")
  })

  it("prints identity + long footer consistently in HTML and ESC/POS; logo absent from ESC/POS raster", () => {
    const data = mapRetailReceiptApiToEscpos(body(), "GHS", "₵")
    data.footerText =
      "Please keep this receipt. Returns only under our written shop policy — contact us for details."
    const html = generateReceiptHTML(data, {
      width: "58mm",
      mode: "full",
      showLogo: true,
      showQR: false,
      footerText: data.footerText,
    })
    expect(html).toContain("receipt-header-logo")
    expect(html).toContain("https://cdn.example.com/acme.png")
    expect(html).toContain("12 High St")
    expect(html).toContain("Tel: 055100200")
    expect(html).toContain("shop@<wbr>acme.<wbr>test")
    expect(html).toContain("Please keep this receipt")

    const esc = new TextDecoder().decode(new ESCPOSGenerator("58mm", "full", false, false, true, false).generate(data))
    expect(esc).toContain("Acme Shop")
    expect(esc).toContain("12 High St")
    expect(esc).toContain("Tel: 055100200")
    expect(esc).toContain("Please keep this receipt")
    // No raster logo payload — text fallback only
    expect(esc).not.toContain("https://cdn.example.com/acme.png")
  })

  it("omits footer when tenant left it blank", () => {
    const data = mapRetailReceiptApiToEscpos(body(), "GHS", "₵")
    const html = generateReceiptHTML(data, {
      width: "58mm",
      mode: "full",
      showLogo: false,
      showQR: false,
      footerText: "",
    })
    expect(html).not.toContain("Thank you for your purchase")
    expect(html).not.toContain("goods sold out")
  })

  it("keeps receipt settings page tenant-scoped and free of returns-policy prefills", () => {
    const page = readFileSync(join(repoRoot, "app/admin/retail/receipt-settings/page.impl.tsx"), "utf8")
    expect(page).toMatch(/Receipt footer \(optional\)/)
    expect(page).not.toMatch(/No refunds after 48 hours/)
    expect(page).not.toMatch(/055 XXXX XXX/)
    expect(page).toMatch(/Edit logo/)
    expect(page).toMatch(/ESC\/POS serial path/)
    const payload = readFileSync(join(repoRoot, "lib/retail/getRetailSaleReceiptPayloadForBusiness.ts"), "utf8")
    expect(payload).toContain("address_street")
    expect(payload).toContain("business_id")
  })
})
