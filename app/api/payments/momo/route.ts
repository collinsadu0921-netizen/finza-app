import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Generate MTN MoMo API token
async function generateMomoToken(apiUser: string, apiKey: string): Promise<string> {
  const credentials = Buffer.from(`${apiUser}:${apiKey}`).toString("base64")

  const response = await fetch("https://proxy.momoapi.mtn.com/collection/token/", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Ocp-Apim-Subscription-Key": apiKey,
      "X-Target-Environment": "mtnghana",
    },
  })

  if (!response.ok) {
    throw new Error("Failed to generate MTN MoMo token")
  }

  const data = await response.json()
  return data.access_token
}

// Generate UUID
function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// Send payment request to MTN MoMo
async function requestPayment(
  token: string,
  primaryKey: string,
  amount: string,
  phone: string,
  reference: string,
  description: string
): Promise<{ status: string; transactionId?: string; message?: string }> {
  // Generate X-Reference-Id (UUID)
  const xReferenceId = generateUUID()

  // Format phone number (remove leading 0, ensure starts with 233)
  let formattedPhone = phone.trim().replace(/^0/, "")
  if (!formattedPhone.startsWith("233")) {
    formattedPhone = `233${formattedPhone}`
  }

  const response = await fetch(
    "https://proxy.momoapi.mtn.com/collection/v1_0/requesttopay",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Reference-Id": xReferenceId,
        "X-Target-Environment": "mtnghana",
        "Ocp-Apim-Subscription-Key": primaryKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amount,
        currency: "GHS",
        externalId: reference,
        payer: {
          partyIdType: "MSISDN",
          partyId: formattedPhone,
        },
        payerMessage: description || "FINZA Sale",
        payeeNote: "FINZA POS",
      }),
    }
  )

  if (response.status === 202) {
    // Payment request accepted
    return {
      status: "accepted",
      transactionId: xReferenceId,
    }
  }

  const errorData = await response.json().catch(() => ({}))
  return {
    status: "failed",
    message: errorData.message || "Payment request failed",
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { business_id, amount, phone, reference, description } = body

    if (!business_id || !amount || !phone || !reference) {
      return NextResponse.json(
        { status: "failed", message: "Missing required fields" },
        { status: 400 }
      )
    }

    // Load business MoMo settings
    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("momo_settings")
      .eq("id", business_id)
      .single()

    if (businessError || !business) {
      return NextResponse.json(
        { status: "failed", message: "Business not found" },
        { status: 404 }
      )
    }

    const momoSettings = business.momo_settings as {
      api_user?: string
      api_key?: string
      primary_key?: string
      callback_url?: string
    } | null

    if (!momoSettings || !momoSettings.api_user || !momoSettings.api_key || !momoSettings.primary_key) {
      return NextResponse.json(
        { status: "failed", message: "MTN MoMo settings not configured" },
        { status: 400 }
      )
    }

    // Generate API token
    const token = await generateMomoToken(momoSettings.api_user, momoSettings.api_key)

    // Send payment request
    const result = await requestPayment(
      token,
      momoSettings.primary_key,
      amount,
      phone,
      reference,
      description
    )

    if (result.status === "accepted" && result.transactionId) {
      // Update sale with transaction ID
      await supabase
        .from("sales")
        .update({
          momo_transaction_id: result.transactionId,
          payment_reference: reference,
        })
        .eq("id", reference)
    }

    return NextResponse.json(result)
  } catch (error: any) {
    return NextResponse.json(
      { status: "failed", message: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

