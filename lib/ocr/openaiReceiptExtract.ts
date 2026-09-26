import OpenAI, { APIConnectionTimeoutError, APIError, RateLimitError } from "openai"
import {
  normalizeReceiptExtraction,
  receiptExtractionSchema,
  type ReceiptExtraction,
} from "@/lib/ocr/openaiReceiptSchema"
import {
  buildReceiptExtractionRequest,
  defaultReceiptAiModel,
  RECEIPT_AI_TIMEOUT_MS,
} from "@/lib/ocr/openaiReceiptRequest"

export type ReceiptAiTelemetry = {
  model: string
  durationMs: number
  success: boolean
  fileType: string
  fileBytes: number
  inputTokens?: number
  outputTokens?: number
  requestId?: string
  code?: string
}

/** Metadata only. Never include the image, transcript, supplier, or amounts. */
export function logReceiptAiEvent(event: ReceiptAiTelemetry): void {
  console.info("[receipt-extract-ai]", event)
}

export class ReceiptAiError extends Error {
  readonly code: string
  readonly httpStatus: number

  constructor(code: string, httpStatus: number, message: string) {
    super(message)
    this.code = code
    this.httpStatus = httpStatus
  }
}

type ParsedResponse = {
  id?: string
  output_parsed?: unknown
  output?: Array<{ type?: string; content?: Array<{ type?: string }> }>
  usage?: { input_tokens?: number; output_tokens?: number } | null
  _request_id?: string | null
}

export type ReceiptAiClient = {
  responses: {
    parse: (body: ReturnType<typeof buildReceiptExtractionRequest>, options?: { timeout?: number; maxRetries?: number }) => Promise<ParsedResponse>
  }
}

export function classifyOpenAiFailure(error: unknown): ReceiptAiError {
  if (error instanceof ReceiptAiError) return error
  if (error instanceof APIConnectionTimeoutError) {
    return new ReceiptAiError("AI_TIMEOUT", 504, "Receipt reading timed out. Try again.")
  }
  if (error instanceof RateLimitError) {
    return new ReceiptAiError("AI_UPSTREAM_RATE_LIMIT", 429, "Receipt reading is busy. Try again in a moment.")
  }
  if (error instanceof APIError) {
    return new ReceiptAiError("AI_UPSTREAM_ERROR", 502, "Receipt reading failed. Try again.")
  }
  return new ReceiptAiError("AI_UPSTREAM_ERROR", 502, "Receipt reading failed. Try again.")
}

function refusalInOutput(output: ParsedResponse["output"]): boolean {
  if (!output) return false
  return output.some((item) => item.type === "message" && item.content?.some((part) => part.type === "refusal"))
}

export function createReceiptAiClient(apiKey: string): OpenAI {
  return new OpenAI({ apiKey, timeout: RECEIPT_AI_TIMEOUT_MS, maxRetries: 0 })
}

export async function extractReceiptWithOpenAi(args: {
  bytes: Uint8Array
  mime: string
  filename: string
  model?: string
  client?: ReceiptAiClient
}): Promise<{ extraction: ReceiptExtraction; model: string; usage?: { inputTokens?: number; outputTokens?: number }; requestId?: string; durationMs: number }> {
  const model = args.model?.trim() || defaultReceiptAiModel()
  const started = Date.now()
  const client = args.client ?? createReceiptAiClient(process.env.OPENAI_API_KEY?.trim() || "")
  if (!args.client && !process.env.OPENAI_API_KEY?.trim()) {
    throw new ReceiptAiError("AI_NOT_CONFIGURED", 503, "Receipt reading is not configured.")
  }

  let response: ParsedResponse
  try {
    response = await client.responses.parse(
      buildReceiptExtractionRequest({
        model,
        mime: args.mime,
        filename: args.filename,
        bytes: args.bytes,
      }),
      { timeout: RECEIPT_AI_TIMEOUT_MS, maxRetries: 0 }
    )
  } catch (error) {
    throw classifyOpenAiFailure(error)
  }

  if (refusalInOutput(response.output)) {
    throw new ReceiptAiError("AI_REFUSAL", 422, "The receipt could not be read.")
  }

  const parsed = receiptExtractionSchema.safeParse(response.output_parsed)
  if (!parsed.success) {
    throw new ReceiptAiError("AI_PARSE_FAILED", 502, "Receipt reading returned an unusable result.")
  }

  return {
    extraction: normalizeReceiptExtraction(parsed.data),
    model,
    usage: response.usage
      ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
      : undefined,
    requestId: response._request_id || response.id,
    durationMs: Date.now() - started,
  }
}
