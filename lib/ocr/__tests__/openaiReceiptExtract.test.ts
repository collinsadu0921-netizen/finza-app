import { describe, expect, it } from "@jest/globals"
import { buildReceiptExtractionRequest, RECEIPT_IMAGE_DETAIL } from "@/lib/ocr/openaiReceiptRequest"
import { normalizeCurrencyCode, normalizeReceiptExtraction, type ReceiptExtraction } from "@/lib/ocr/openaiReceiptSchema"
import { classifyOpenAiFailure, extractReceiptWithOpenAi, ReceiptAiError } from "@/lib/ocr/openaiReceiptExtract"
import { APIConnectionTimeoutError, RateLimitError } from "openai"

const base: ReceiptExtraction = {
  document_type: "receipt",
  supplier_name: " KOFI SHOP LTD ",
  document_date: "2026-03-12",
  total_amount: 45.5,
  currency: "GH₵",
  subtotal: 40,
  tax_amount: 5.5,
  receipt_number: " 18 ",
  supplier_tax_id: null,
  evidence: {
    supplier: "KOFI SHOP LTD",
    date: "DATE: 12/03/2026",
    total: "GRAND TOTAL GHS 45.50",
    currency: "GHS",
  },
  warnings: [],
  clarity: { supplier: "high", date: "high", total: "high", currency: "high" },
}

describe("OpenAI receipt request", () => {
  it("sends a JPEG as a high-detail data URL and does not store the response", () => {
    const request = buildReceiptExtractionRequest({
      model: "gpt-6-luna",
      mime: "image/jpeg",
      filename: "receipt.jpg",
      bytes: Uint8Array.from([1, 2, 3]),
    })
    expect(request.store).toBe(false)
    expect(request.reasoning).toEqual({ effort: "none" })
    expect(request.model).toBe("gpt-6-luna")
    const part = request.input[0].content[1]
    expect(part).toMatchObject({ type: "input_image", detail: RECEIPT_IMAGE_DETAIL })
    expect("image_url" in part && part.image_url.startsWith("data:image/jpeg;base64,")).toBe(true)
    expect(JSON.stringify(request.input)).not.toContain("https://")
    expect(JSON.stringify(request.input)).not.toContain("http://")
  })

  it("sends a PDF as input_file base64", () => {
    const request = buildReceiptExtractionRequest({
      model: "gpt-6-luna",
      mime: "application/pdf",
      filename: "invoice.pdf",
      bytes: Uint8Array.from([4, 5]),
    })
    const part = request.input[0].content[1]
    expect(part).toMatchObject({ type: "input_file", filename: "invoice.pdf" })
    expect("file_data" in part && part.file_data.startsWith("data:application/pdf;base64,")).toBe(true)
  })
})

describe("normalizeReceiptExtraction", () => {
  it("keeps readable fields and normalizes Ghana currency", () => {
    const next = normalizeReceiptExtraction(base)
    expect(next.supplier_name).toBe("KOFI SHOP LTD")
    expect(next.document_date).toBe("2026-03-12")
    expect(next.total_amount).toBe(45.5)
    expect(next.currency).toBe("GHS")
  })

  it("drops unreadable dates and blank values instead of guessing", () => {
    const next = normalizeReceiptExtraction({
      ...base,
      supplier_name: "  ",
      document_date: "12/03/2026",
      total_amount: Number.NaN,
      currency: null,
    })
    expect(next.supplier_name).toBeNull()
    expect(next.document_date).toBeNull()
    expect(next.total_amount).toBeNull()
    expect(next.currency).toBeNull()
    expect(next.warnings).toContain("date_not_iso")
  })

  it("drops a non-currency token instead of keeping punctuation", () => {
    expect(normalizeCurrencyCode(".")).toBeNull()
    expect(normalizeCurrencyCode("GH₵")).toBe("GHS")
  })
})

describe("extractReceiptWithOpenAi", () => {
  it("returns parsed structured output", async () => {
    const result = await extractReceiptWithOpenAi({
      bytes: Uint8Array.from([1]),
      mime: "image/jpeg",
      filename: "a.jpg",
      model: "gpt-6-luna",
      client: {
        responses: {
          parse: async () => ({
            id: "resp_test",
            output_parsed: base,
            usage: { input_tokens: 100, output_tokens: 40 },
          }),
        },
      },
    })
    expect(result.model).toBe("gpt-6-luna")
    expect(result.extraction.supplier_name).toBe("KOFI SHOP LTD")
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 40 })
  })

  it("maps timeout and rate limit without leaking the SDK message", () => {
    const timeout = classifyOpenAiFailure(new APIConnectionTimeoutError({ message: "secret request body should not leak" }))
    expect(timeout).toBeInstanceOf(ReceiptAiError)
    expect(timeout.code).toBe("AI_TIMEOUT")
    expect(timeout.message).not.toContain("secret")
    const limited = classifyOpenAiFailure(new RateLimitError(429, undefined, "slow down", new Headers()))
    expect(limited.code).toBe("AI_UPSTREAM_RATE_LIMIT")
    expect(limited.message).not.toContain("slow down")
  })

  it("rejects a refusal", async () => {
    await expect(
      extractReceiptWithOpenAi({
        bytes: Uint8Array.from([1]),
        mime: "image/jpeg",
        filename: "a.jpg",
        client: {
          responses: {
            parse: async () => ({
              output_parsed: null,
              output: [{ type: "message", content: [{ type: "refusal" }] }],
            }),
          },
        },
      })
    ).rejects.toMatchObject({ code: "AI_REFUSAL" })
  })
})

