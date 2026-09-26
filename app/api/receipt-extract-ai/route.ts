import { NextRequest, NextResponse } from "next/server"
import { checkReceiptFile } from "@/lib/ocr/receiptFileLimits"
import { extractReceiptWithOpenAi, logReceiptAiEvent, ReceiptAiError } from "@/lib/ocr/openaiReceiptExtract"
import { defaultReceiptAiModel } from "@/lib/ocr/openaiReceiptRequest"
import { checkReceiptAiRateLimit } from "@/lib/ocr/receiptAiRateLimit"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { enforceServiceWorkspaceAccess } from "@/lib/serviceWorkspace/enforceServiceWorkspaceAccess"

export const runtime = "nodejs"
export const maxDuration = 60

const STAGE = "openai_receipt_extraction"

function fail(status: number, code: string, error: string) {
  return NextResponse.json({ ok: false, code, error, stage: STAGE }, { status })
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail(401, "AI_UNAUTHORIZED", "Unauthorized")

  const rate = checkReceiptAiRateLimit(user.id)
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, code: "AI_RATE_LIMITED", error: "Too many receipt reads. Try again shortly.", stage: STAGE, retryAfterSec: rate.retryAfterSec },
      { status: 429 }
    )
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return fail(400, "AI_BAD_REQUEST", "Expected a receipt file upload.")
  }

  const businessId = String(form.get("business_id") || "").trim()
  if (!businessId) return fail(400, "AI_BAD_REQUEST", "business_id is required")

  const denied = await enforceServiceWorkspaceAccess({
    supabase,
    userId: user.id,
    businessId,
    minTier: "starter",
    mode: "read",
  })
  if (denied) {
    const body = await denied.json().catch(() => ({ error: "Forbidden" }))
    const message = typeof body?.error === "string" ? body.error : "Forbidden"
    return fail(denied.status, denied.status === 401 ? "AI_UNAUTHORIZED" : "AI_FORBIDDEN", message)
  }

  const file = form.get("file")
  if (!(file instanceof File)) return fail(400, "AI_BAD_REQUEST", "file is required")

  const checked = checkReceiptFile({ name: file.name, type: file.type, size: file.size })
  if (!checked.ok) {
    const tooLarge = checked.code === "OCR_FILE_TOO_LARGE"
    return fail(400, tooLarge ? "AI_FILE_TOO_LARGE" : "AI_UNSUPPORTED_TYPE", tooLarge ? "That file is too large." : "Use a JPG, PNG, WEBP, or PDF receipt.")
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.byteLength === 0) return fail(400, "AI_FILE_TOO_LARGE", "The file is empty.")

  const started = Date.now()
  try {
    const result = await extractReceiptWithOpenAi({
      bytes,
      mime: checked.mime,
      filename: file.name || "receipt",
    })
    logReceiptAiEvent({
      model: result.model,
      durationMs: result.durationMs,
      success: true,
      fileType: checked.mime,
      fileBytes: bytes.byteLength,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      requestId: result.requestId,
    })
    return NextResponse.json({
      ok: true,
      engine: "openai",
      model: result.model,
      extraction: result.extraction,
    })
  } catch (error) {
    const mapped = error instanceof ReceiptAiError ? error : new ReceiptAiError("AI_UPSTREAM_ERROR", 502, "Receipt reading failed. Try again.")
    logReceiptAiEvent({
      model: defaultReceiptAiModel(),
      durationMs: Date.now() - started,
      success: false,
      fileType: checked.mime,
      fileBytes: bytes.byteLength,
      code: mapped.code,
    })
    return fail(mapped.httpStatus, mapped.code, mapped.message)
  }
}
