import { receiptFileKind, receiptPublicUrl } from "@/lib/storage/receiptFileUrl"

describe("receipt file urls", () => {
  const previous = process.env.NEXT_PUBLIC_SUPABASE_URL

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
  })

  afterAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = previous
  })

  it("turns a storage path into a public receipts URL", () => {
    expect(receiptPublicUrl("expenses/biz/1.jpg")).toBe(
      "https://example.supabase.co/storage/v1/object/public/receipts/expenses/biz/1.jpg"
    )
  })

  it("keeps an existing URL and does not echo a blank path", () => {
    expect(receiptPublicUrl("https://cdn.example/a.pdf")).toBe("https://cdn.example/a.pdf")
    expect(receiptPublicUrl("  ")).toBeNull()
  })

  it("classifies images and PDFs", () => {
    expect(receiptFileKind("expenses/a.PNG")).toBe("image")
    expect(receiptFileKind("bills/a.pdf?token=1")).toBe("pdf")
  })
})