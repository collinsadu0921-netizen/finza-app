import { NextRequest, NextResponse } from "next/server"
import OpenAI from "openai"

const SYSTEM_PROMPT = `You are Finza Assist, a finance assistant for a Ghanaian small business using Finza, a ledger-first accounting platform.
You help users understand finances, explain transactions, VAT (flat rate and standard scheme), income tax, withholding tax, and bookkeeping.
Be concise and practical.

Routing rules:
- Prefer real, clickable app routes.
- For this workspace, prefer /service/* routes when guiding users.
- Only suggest a route that exists in the sitemap below.
- If no exact route exists, clearly say it is coming soon.

Authoritative service sitemap:
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
/service/settings/integrations/whatsapp
/service/accounting
/service/accounting/wht
/service/accounting/cit
/service/accounting/adjustment
/service/accounting/bank-reconciliation
/service/accounting/contribution
/service/accounting/loan
/service/invitations
/service/health`

function getClient() {
  const baseURL = process.env.AI_BASE_URL || "http://localhost:11434/v1"
  const apiKey = process.env.AI_API_KEY || "ollama"

  return new OpenAI({
    baseURL,
    apiKey,
  })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const message = String(body?.message || "").trim()
    const context = body?.context ?? null

    if (!message) {
      return NextResponse.json({ error: "message is required" }, { status: 400 })
    }

    const model = process.env.AI_MODEL || "gemma3:12b"
    const client = getClient()

    const serializedContext = context == null ? null : JSON.stringify(context)
    const systemPrompt = serializedContext
      ? `${SYSTEM_PROMPT}\n\nHere is the user's current financial data: ${serializedContext}`
      : SYSTEM_PROMPT

    const stream = await client.chat.completions.create({
      model,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
    })

    const encoder = new TextEncoder()
    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const text = chunk.choices?.[0]?.delta?.content
            if (text) {
              controller.enqueue(encoder.encode(text))
            }
          }
          controller.close()
        } catch (error) {
          controller.error(error)
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
  } catch (error: any) {
    console.error("Error in /api/ai:", error)
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    )
  }
}

