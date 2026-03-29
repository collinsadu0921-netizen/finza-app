import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { getCurrentBusiness } from "@/lib/business"
import { generateText } from "ai"
import { createOpenAI } from "@ai-sdk/openai"

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const business = await getCurrentBusiness(supabase, user.id)
    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 })
    }

    const body = await request.json()
    const question = String(body?.question || "").trim()
    const step = String(body?.step || "").trim() || "unknown_step"

    if (!question) {
      return NextResponse.json({ error: "Question is required" }, { status: 400 })
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "AI assistant is not configured. Add OPENAI_API_KEY to environment variables." },
        { status: 503 }
      )
    }

    const modelId = process.env.ONBOARDING_AI_MODEL || "gpt-5-mini"
    const legalName = business.legal_name || business.name || "your business"
    const industry = business.industry || "unknown"
    const country = business.address_country || business.country_code || "unknown"
    const currency = business.default_currency || "unknown"

    const systemPrompt = [
      "You are Finza's onboarding assistant.",
      "Your job is to help new customers complete onboarding steps clearly and quickly.",
      "Keep responses concise, practical, and action-oriented.",
      "Always reference Finza workflows and step-by-step actions.",
      "If user asks for accounting/tax advice, provide high-level guidance and recommend confirming with a qualified accountant.",
      "Do not invent product features. If uncertain, say what to verify in settings.",
    ].join(" ")

    const contextPrompt = [
      `Business: ${legalName}`,
      `Industry: ${industry}`,
      `Country: ${country}`,
      `Default currency: ${currency}`,
      `Current onboarding step: ${step}`,
      "",
      `User question: ${question}`,
      "",
      "Answer with:",
      "1) short explanation",
      "2) exact next clicks/pages in Finza",
      "3) one common mistake to avoid",
    ].join("\n")

    const result = await generateText({
      model: openai(modelId),
      system: systemPrompt,
      prompt: contextPrompt,
      maxOutputTokens: 450,
    })

    return NextResponse.json({ answer: result.text })
  } catch (error: any) {
    console.error("Error in onboarding assistant:", error)
    return NextResponse.json(
      { error: error?.message || "Failed to generate assistant response" },
      { status: 500 }
    )
  }
}

