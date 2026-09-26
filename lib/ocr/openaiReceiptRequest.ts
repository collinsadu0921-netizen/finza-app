import { zodTextFormat } from "openai/helpers/zod"
import { RECEIPT_EXTRACTION_PROMPT, receiptExtractionSchema } from "@/lib/ocr/openaiReceiptSchema"

export const RECEIPT_IMAGE_DETAIL = "high" as const
export const RECEIPT_AI_TIMEOUT_MS = 45_000
export const RECEIPT_AI_MAX_OUTPUT_TOKENS = 1200

export function defaultReceiptAiModel(): string {
  const configured = process.env.OPENAI_RECEIPT_MODEL?.trim()
  return configured || "gpt-6-luna"
}

export function receiptAiExtractEnabled(): boolean {
  return process.env.RECEIPT_AI_EXTRACT_ENABLED === "true"
}

export function buildReceiptExtractionRequest(args: {
  model: string
  mime: string
  filename: string
  bytes: Uint8Array
}) {
  const base64 = Buffer.from(args.bytes).toString("base64")
  const dataUrl = `data:${args.mime};base64,${base64}`
  const filePart =
    args.mime === "application/pdf"
      ? {
          type: "input_file" as const,
          filename: args.filename || "receipt.pdf",
          file_data: dataUrl,
        }
      : {
          type: "input_image" as const,
          image_url: dataUrl,
          detail: RECEIPT_IMAGE_DETAIL,
        }

  return {
    model: args.model,
    store: false as const,
    reasoning: { effort: "none" as const },
    max_output_tokens: RECEIPT_AI_MAX_OUTPUT_TOKENS,
    input: [
      {
        role: "user" as const,
        content: [{ type: "input_text" as const, text: RECEIPT_EXTRACTION_PROMPT }, filePart],
      },
    ],
    text: {
      format: zodTextFormat(receiptExtractionSchema, "receipt_extraction"),
    },
  }
}
