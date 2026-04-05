import { NextRequest, NextResponse } from "next/server"
import OpenAI from "openai"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import {
  FINZA_ASSIST_TOOL_DEFINITIONS,
  executeFinzaAssistTool,
  checkAiRateLimit,
} from "@/lib/ai/finzaAssistTools"
import { performReceiptOcr } from "@/lib/receipt/performReceiptOcr"
import type { DocumentType } from "@/lib/receipt/receiptOcr"

/** Receipt OCR + LLM can exceed default serverless limits; align with /api/receipt-ocr. */
export const maxDuration = 120
export const runtime = "nodejs"

const SITEMAP = `Authoritative service sitemap:
/service
/service/dashboard
/service/invoices
/service/invoices/new
/service/invoices/create
/service/invoices/recurring
/service/invoices/[id]
/service/invoices/[id]/view
/service/invoices/[id]/edit
/service/estimates
/service/estimates/new
/service/estimates/create
/service/estimates/[id]
/service/estimates/[id]/view
/service/estimates/[id]/edit
/service/estimates/[id]/convert
/service/proforma
/service/proforma/create
/service/proforma/[id]/view
/service/proforma/[id]/edit
/service/credit-notes
/service/credit-notes/create
/service/credit-notes/[id]/view
/service/payments
/service/bills
/bills/create
/service/expenses
/service/expenses/create
/service/expenses/categories
/service/expenses/activity
/service/expenses/[id]/view
/service/expenses/[id]/edit
/service/customers
/service/customers/new
/service/customers/[id]
/service/suppliers
/service/suppliers/new
/service/suppliers/[id]
/service/services
/service/services/new
/service/services/[id]/edit
/service/jobs
/service/jobs/new
/service/jobs/[id]
/service/materials
/service/materials/new
/service/materials/[id]/edit
/service/materials/[id]/adjust
/service/inventory
/service/products
/service/assets
/service/ledger
/service/recurring
/service/payroll
/service/payroll/advances
/service/reports
/service/reports/profit-and-loss
/service/reports/balance-sheet
/service/reports/trial-balance
/service/reports/cash-flow
/service/reports/equity-changes
/service/settings
/service/settings/business-profile
/service/settings/invoice-settings
/service/settings/payments
/service/settings/subscription
/service/settings/staff
/service/settings/team
/settings/communication/whatsapp
/service/accounting
/service/accounting/wht
/service/accounting/cit
/service/accounting/adjustment
/service/accounting/bank-reconciliation
/service/accounting/contribution
/service/accounting/loan
/service/invitations
/service/health`

const GUARDRAILS = `Guardrails (mandatory):
- You cannot create, edit, delete, or post any data in Finza. You do not run transactions, journals, payments, invoices, or tax filings.
- For numbers and lists about THIS business, prefer facts returned from tool calls (they are read-only and server-verified). Client-provided JSON may be stale; say so if it conflicts with tools.
- Do not invent routes: only use paths from the sitemap. If unsure, say the page may be under Settings or suggest /service/dashboard.
- You give educational guidance on Ghana VAT/WHT/PAYE and bookkeeping — not legal or binding tax advice; suggest a qualified accountant for edge cases.
- Never ask for passwords, PINs, API keys, or full card numbers.
- Keep answers concise. When giving navigation, lead with one line: Go to: /service/... then brief steps.`

const BASE_INSTRUCTIONS = `You are Finza Assist, a finance assistant for a Ghanaian small business using Finza, a ledger-first accounting platform.
You help users understand finances, explain transactions, VAT (flat rate and standard scheme), income tax, withholding tax, and bookkeeping.

Read-only tools (live server data): get_dashboard_summary; search_invoices (invoice number and/or customer name); search_bills; search_customers; list_open_invoices (receivables, optional overdue_only); get_invoice_detail (UUID); get_tax_profile; get_payroll_runs_summary; get_expense_totals_by_category (by month); get_profit_and_loss_summary and get_balance_sheet_summary (ledger reports — may return ok:false if the user lacks report access or accounting is not initialized). extract_receipt_ocr reads stored receipt images (suggestion only).

When the user attaches a receipt in Assist, the server may include a pre-extracted OCR block — summarize it; figures are unverified until they save an expense or bill. Receipt OCR does not post to the ledger.

Human-in-the-loop drafts (you do NOT save data): suggest pre-filled forms the user reviews and saves. Expense: Go to: /service/expenses/create?draft_supplier=...&draft_amount=...&draft_notes=...&draft_date=YYYY-MM-DD (URL-encode values). Supplier bill: Go to: /bills/create?draft_supplier_name=...&draft_notes=...&draft_issue_date=YYYY-MM-DD&draft_line_description=...&draft_line_unit_price=... (single default line). Say drafts are unverified.

Payroll: for salary paid, net pay, PAYE/SSNIT from payroll, payslips, or payroll by month, call get_payroll_runs_summary (all_history / include_staff_entries as needed). Do not answer payroll-only questions from get_dashboard_summary alone.

If context includes page_invoice_id (from the invoice view/edit screen) or other ids in the UI snapshot, use them when relevant — e.g. call get_invoice_detail for page_invoice_id. Still use tools for authoritative figures when asked.

Routing: prefer /service/* URLs. ${SITEMAP}

${GUARDRAILS}`

function getClient() {
  const baseURL = process.env.AI_BASE_URL || "http://localhost:11434/v1"
  const apiKey = process.env.AI_API_KEY || "ollama"

  return new OpenAI({
    baseURL,
    apiKey,
  })
}

const MAX_TOOL_ROUNDS = 5
const MAX_TOOL_CALLS_PER_REQUEST = 10

async function streamTextResponse(text: string): Promise<Response> {
  const encoder = new TextEncoder()
  const chunkSize = 48
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (let i = 0; i < text.length; i += chunkSize) {
          controller.enqueue(encoder.encode(text.slice(i, i + chunkSize)))
        }
        controller.close()
      } catch (e) {
        controller.error(e)
      }
    },
  })
  return new NextResponse(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    let message = String(body?.message || "").trim()
    const context = body?.context ?? null
    const receiptPathRaw = body?.receipt_path
    const receiptDocRaw = body?.document_type
    const receiptPath =
      typeof receiptPathRaw === "string" && receiptPathRaw.trim() ? receiptPathRaw.trim() : ""

    if (!message && !receiptPath) {
      return NextResponse.json({ error: "message or receipt_path is required" }, { status: 400 })
    }

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const rate = checkAiRateLimit(user.id)
    if (!rate.ok) {
      return NextResponse.json(
        { error: `Too many requests. Try again in ${rate.retryAfterSec}s.` },
        { status: 429 }
      )
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business?.id) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    let receiptOcrPrefix = ""
    if (receiptPath) {
      const docType: DocumentType =
        receiptDocRaw === "supplier_bill" ? "supplier_bill" : "expense"
      const ocr = await performReceiptOcr(supabase, {
        userId: user.id,
        businessId: business.id,
        receiptPath,
        documentType: docType,
      })
      if (ocr.ok) {
        receiptOcrPrefix = `[Attached receipt OCR — suggestion only, not booked]\n${JSON.stringify({
          suggestions: ocr.suggestions,
          confidence: ocr.confidence,
          receipt_path: receiptPath,
          document_type: docType,
        })}\n\n`
      } else {
        receiptOcrPrefix = `[Attached receipt OCR failed]\n${JSON.stringify({
          error: ocr.error,
          code: ocr.code,
          receipt_path: receiptPath,
        })}\n\n`
      }
    }

    if (!message) {
      message =
        "Summarize what was read from the attached receipt, list amounts and dates clearly, and tell me how to record this in Finza if I want to."
    }

    const model = process.env.AI_MODEL || "gemma3:12b"
    const client = getClient()

    const contextNote =
      context == null
        ? ""
        : `\n\nOptional client UI snapshot (may be stale; prefer tools for authoritative figures): ${JSON.stringify(context)}`

    const systemContent = `${BASE_INSTRUCTIONS}${contextNote}`

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: systemContent },
      { role: "user", content: receiptOcrPrefix + message },
    ]

    let toolCallsSoFar = 0
    let finalText = ""
    let usedTools = false

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let completion: OpenAI.Chat.Completions.ChatCompletion
      try {
        completion = await client.chat.completions.create({
          model,
          messages,
          tools: FINZA_ASSIST_TOOL_DEFINITIONS,
          tool_choice: "auto",
          stream: false,
        })
      } catch (toolErr: unknown) {
        const msg = toolErr instanceof Error ? toolErr.message : String(toolErr)
        console.warn("[api/ai] Tool-enabled completion failed, retrying without tools:", msg)
        const llmStream = await client.chat.completions.create({
          model,
          messages,
          stream: true,
        })
        const encoder = new TextEncoder()
        const readable = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              for await (const chunk of llmStream) {
                const text = chunk.choices?.[0]?.delta?.content
                if (text) controller.enqueue(encoder.encode(text))
              }
              controller.close()
            } catch (e) {
              controller.error(e)
            }
          },
        })
        return new NextResponse(readable, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        })
      }

      const choice = completion.choices[0]
      const assistantMessage = choice?.message
      if (!assistantMessage) break

      const toolCalls = assistantMessage.tool_calls
      if (toolCalls?.length) {
        usedTools = true
        messages.push({
          role: "assistant",
          content: assistantMessage.content ?? null,
          tool_calls: toolCalls,
        })

        for (const tc of toolCalls) {
          if (tc.type !== "function") continue
          if (toolCallsSoFar >= MAX_TOOL_CALLS_PER_REQUEST) {
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify({
                error: "Tool call limit reached for this request. Answer from what you already know.",
              }),
            })
            continue
          }
          toolCallsSoFar += 1
          const name = tc.function.name
          const args = tc.function.arguments || "{}"
          const exec = await executeFinzaAssistTool(supabase, business.id, user.id, name, args)
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: exec.ok ? exec.result : JSON.stringify({ error: exec.error }),
          })
        }
        continue
      }

      finalText = (assistantMessage.content || "").trim()
      break
    }

    if (!finalText) {
      finalText = usedTools
        ? "I ran the requested lookups but could not form a reply. Please try rephrasing your question."
        : "I could not generate a reply. Check that your local model is running and try again."
    }

    return streamTextResponse(finalText)
  } catch (error: unknown) {
    console.error("Error in /api/ai:", error)
    const msg = error instanceof Error ? error.message : "Internal server error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
