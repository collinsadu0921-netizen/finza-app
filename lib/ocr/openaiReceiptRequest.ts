import { zodTextFormat } from "openai/helpers/zod"
import type { ZodType } from "zod"
import { RECEIPT_EXTRACTION_PROMPT, receiptExtractionSchema } from "@/lib/ocr/openaiReceiptSchema"
import { SUPPLIER_BILL_EXTRACTION_PROMPT, supplierBillExtractionSchema } from "@/lib/ocr/supplierBillExtraction"

export const RECEIPT_IMAGE_DETAIL = "high" as const
export const RECEIPT_AI_TIMEOUT_MS = 45_000
export const RECEIPT_AI_MAX_OUTPUT_TOKENS = 1200
export const SUPPLIER_BILL_AI_MAX_OUTPUT_TOKENS = 4000

export type ReceiptExtractionMode = "expense" | "supplier_bill"

export function defaultReceiptAiModel(): string {
  const configured = process.env.OPENAI_RECEIPT_MODEL?.trim()
  return configured || "gpt-6-luna"
}

function receiptFilePart(args: { mime: string; filename: string; bytes: Uint8Array }) {
  const base64 = Buffer.from(args.bytes).toString("base64")
  const dataUrl = `data:${args.mime};base64,${base64}`
  if (args.mime === "application/pdf") {
    return {
      type: "input_file" as const,
      filename: args.filename || "receipt.pdf",
      file_data: dataUrl,
    }
  }
  return {
    type: "input_image" as const,
    image_url: dataUrl,
    detail: RECEIPT_IMAGE_DETAIL,
  }
}

export function buildReceiptExtractionRequest(args: {
  model: string
  mime: string
  filename: string
  bytes: Uint8Array
  mode?: ReceiptExtractionMode
}) {
  const supplierBill = args.mode === "supplier_bill"
  const prompt = supplierBill ? SUPPLIER_BILL_EXTRACTION_PROMPT : RECEIPT_EXTRACTION_PROMPT
  const schema = (supplierBill ? supplierBillExtractionSchema : receiptExtractionSchema) as ZodType
  return {
    model: args.model,
    store: false as const,
    reasoning: { effort: "none" as const },
    max_output_tokens: supplierBill ? SUPPLIER_BILL_AI_MAX_OUTPUT_TOKENS : RECEIPT_AI_MAX_OUTPUT_TOKENS,
    input: [
      {
        role: "user" as const,
        content: [{ type: "input_text" as const, text: prompt }, receiptFilePart(args)],
      },
    ],
    text: {
      format: zodTextFormat(schema, supplierBill ? "supplier_bill_extraction" : "receipt_extraction"),
    },
  }
}
