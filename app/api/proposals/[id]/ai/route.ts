import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { proposalCanBeEditedByStaff } from "@/lib/proposals/proposalState"
import { normalizeTemplateId } from "@/lib/proposals/templates"
import { validateAndNormalizePricingForDb } from "@/lib/proposals/pricingForDb"
import { applyProposalAiChanges, applyProposalAiDraft, chapterTitles, findChapterRange } from "@/lib/proposals/ai/apply"
import { loadProposalAiContext } from "@/lib/proposals/ai/context"
import { checkProposalAiRateLimit } from "@/lib/proposals/ai/rateLimit"
import {
  PROPOSAL_AI_MAX_BODY_BYTES,
  proposalAiRequestSchema,
} from "@/lib/proposals/ai/schema"
import type { ProposalAiSnapshot } from "@/lib/proposals/ai/types"
import {
  editProposalDraftWithAi,
  generateProposalDraftWithAi,
  ProposalAiError,
} from "@/lib/proposals/ai/openai"

export const dynamic = "force-dynamic"

function errorResponse(message: string, code: string, status: number, retryAfterSec?: number) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
      code,
      ...(retryAfterSec ? { retry_after_sec: retryAfterSec } : {}),
    },
    {
      status,
      headers: retryAfterSec ? { "Retry-After": String(retryAfterSec) } : undefined,
    }
  )
}

function snapshotFromRequest(
  value: ReturnType<typeof proposalAiRequestSchema.parse>["snapshot"]
): ProposalAiSnapshot | null {
  if (!value) return null
  return {
    title: value.title,
    customer_id: value.customer_id,
    template_id: normalizeTemplateId(value.template_id),
    currency_code: value.currency_code,
    sections: value.sections,
    pricing_mode: value.pricing_mode,
    pricing_payload: value.pricing_payload,
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const { id: proposalId } = await Promise.resolve(params)
    if (!proposalId) return errorResponse("Proposal id required", "BAD_REQUEST", 400)

    const contentLength = Number(request.headers.get("content-length") ?? 0)
    if (Number.isFinite(contentLength) && contentLength > PROPOSAL_AI_MAX_BODY_BYTES) {
      return errorResponse("The AI request is too large.", "REQUEST_TOO_LARGE", 413)
    }

    const raw = await request.text()
    if (raw.length > PROPOSAL_AI_MAX_BODY_BYTES) {
      return errorResponse("The AI request is too large.", "REQUEST_TOO_LARGE", 413)
    }

    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      return errorResponse("Invalid JSON body", "BAD_REQUEST", 400)
    }

    const parsed = proposalAiRequestSchema.safeParse(json)
    if (!parsed.success) {
      return errorResponse(
        parsed.error.issues[0]?.message || "Invalid AI request",
        "VALIDATION_ERROR",
        400
      )
    }
    const body = parsed.data

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return errorResponse("Unauthorized", "UNAUTHORIZED", 401)

    const scope = await resolveBusinessScopeForUser(supabase, user.id, body.business_id)
    if (!scope.ok) {
      return errorResponse(scope.error, "FORBIDDEN", scope.status)
    }
    const businessId = scope.businessId

    const contextResult = await loadProposalAiContext(supabase, { businessId, proposalId })
    if (!contextResult.ok) {
      return errorResponse(contextResult.error, "NOT_FOUND", contextResult.status)
    }
    const context = contextResult.context

    if (!proposalCanBeEditedByStaff(context.proposal.status)) {
      return errorResponse(
        "This proposal can no longer be edited in its current state.",
        "PROPOSAL_LOCKED",
        409
      )
    }

    const rate = checkProposalAiRateLimit(user.id, businessId)
    if (!rate.ok) {
      return errorResponse(
        "Too many AI requests. Try again shortly.",
        "RATE_LIMITED",
        429,
        rate.retryAfterSec
      )
    }

    const clientSnapshot = snapshotFromRequest(body.snapshot)
    const baseSnapshot: ProposalAiSnapshot =
      clientSnapshot ?? {
        title: context.proposal.title,
        customer_id: context.proposal.customerId,
        template_id: context.proposal.templateId,
        currency_code: context.proposal.currencyCode,
        sections: context.proposal.sections,
        pricing_mode: context.proposal.pricingMode,
        pricing_payload: context.proposal.pricingPayload,
      }

    if (baseSnapshot.customer_id) {
      const customerAllowed = context.customers.some(
        (customer) => customer.id === baseSnapshot.customer_id
      )
      if (!customerAllowed) {
        return errorResponse(
          "The selected customer does not belong to this business.",
          "CUSTOMER_NOT_FOUND",
          400
        )
      }
    }

    const pricing = validateAndNormalizePricingForDb(
      baseSnapshot.pricing_mode,
      baseSnapshot.pricing_payload
    )
    baseSnapshot.pricing_mode = pricing.pricing_mode
    baseSnapshot.pricing_payload = pricing.pricing_payload

    if (body.action === "generate") {
      const { draft, usage } = await generateProposalDraftWithAi({
        instruction: body.instruction,
        context,
      })
      const applied = applyProposalAiDraft({
        draft,
        customerIds: new Set(context.customers.map((customer) => customer.id)),
        customerNames: new Map(context.customers.map((customer) => [customer.id, customer.name])),
      })
      if (!applied.ok) {
        return errorResponse(applied.error, "AI_DRAFT_INVALID", 422)
      }
      return NextResponse.json({
        ok: true,
        summary: draft.summary,
        preview: applied.preview,
        usage,
      })
    }

    if (body.action === "edit" && !clientSnapshot) {
      return errorResponse("A current proposal snapshot is required.", "SNAPSHOT_REQUIRED", 400)
    }
    if (
      (body.action === "refine" || body.action === "generate_section") &&
      (!clientSnapshot || !body.chapter_title)
    ) {
      return errorResponse(
        "A current proposal snapshot and chapter title are required.",
        "SNAPSHOT_REQUIRED",
        400
      )
    }

    if (body.action === "refine" && body.chapter_title) {
      const range = findChapterRange(baseSnapshot.sections, body.chapter_title)
      if (!range) {
        return errorResponse(
          `Chapter "${body.chapter_title}" was not found. Available chapters: ${chapterTitles(
            baseSnapshot.sections
          ).join(", ")}.`,
          "CHAPTER_NOT_FOUND",
          400
        )
      }
    }
    if (
      body.action === "generate_section" &&
      body.chapter_title &&
      findChapterRange(baseSnapshot.sections, body.chapter_title)
    ) {
      return errorResponse(
        "That chapter already exists. Use a refinement action instead.",
        "CHAPTER_EXISTS",
        400
      )
    }

    const taskInstruction =
      body.action === "refine" && body.chapter_title
        ? `Revise only the chapter "${body.chapter_title}". ${body.instruction}`
        : body.action === "generate_section" && body.chapter_title
          ? `Add a new chapter titled "${body.chapter_title}". ${body.instruction}`
          : body.instruction

    const { edit, usage } = await editProposalDraftWithAi({
      action: body.action,
      instruction: taskInstruction,
      context,
      snapshot: baseSnapshot,
      chapterTitle: body.chapter_title,
    })

    const applied = applyProposalAiChanges(baseSnapshot, edit)
    if (!applied.ok) {
      return errorResponse(applied.error, "AI_CHANGES_INVALID", 422)
    }

    return NextResponse.json({
      ok: true,
      summary: edit.summary,
      preview: applied.preview,
      usage,
    })
  } catch (error: unknown) {
    if (error instanceof ProposalAiError) {
      return errorResponse(error.message, error.code, error.httpStatus)
    }
    console.error("[proposal-ai] request failed", {
      name: error instanceof Error ? error.name : "unknown",
    })
    return errorResponse("Proposal assistant failed. Try again.", "AI_INTERNAL_ERROR", 500)
  }
}
