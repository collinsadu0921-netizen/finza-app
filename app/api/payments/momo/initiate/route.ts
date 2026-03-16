import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { normalizeCountry, assertProviderAllowed } from "@/lib/payments/eligibility"
import { ensureAccountingInitialized } from "@/lib/accountingBootstrap"

// MTN MoMo API Configuration (to be set in environment variables)
const MTN_MOMO_API_KEY = process.env.MTN_MOMO_API_KEY || ""
const MTN_MOMO_USER_ID = process.env.MTN_MOMO_USER_ID || ""
const MTN_MOMO_PRIMARY_KEY = process.env.MTN_MOMO_PRIMARY_KEY || ""
const MTN_MOMO_ENVIRONMENT = process.env.MTN_MOMO_ENVIRONMENT || "sandbox" // sandbox or production
const MTN_MOMO_BASE_URL = MTN_MOMO_ENVIRONMENT === "production"
  ? "https://api.momodeveloper.mtn.com"
  : "https://sandbox.momodeveloper.mtn.com"

type Provider = "mtn" | "vodafone" | "airteltigo"

export async function POST(request: NextRequest) {
  try {
    let body
    try {
      body = await request.json()
    } catch (parseError: any) {
      console.error("Error parsing request body:", parseError)
      return NextResponse.json(
        { 
          success: false,
          error: "Invalid request format",
          message: "Request body must be valid JSON"
        },
        { status: 400 }
      )
    }

    const { invoice_id, provider, phone_number } = body

    if (!invoice_id || !provider || !phone_number) {
      return NextResponse.json(
        { 
          success: false,
          error: "Missing required fields: invoice_id, provider, and phone_number are required",
          message: "Invalid request"
        },
        { status: 400 }
      )
    }

    const supabase = await createSupabaseServerClient()

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      console.error("Authentication error:", authError)
      return NextResponse.json(
        { 
          success: false,
          error: "User not authenticated",
          message: "Please log in to continue"
        },
        { status: 401 }
      )
    }

    console.log("Authenticated user:", user.id)

    // Fetch invoice details
    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .select("id, invoice_number, total, business_id, status")
      .eq("id", invoice_id)
      .is("deleted_at", null)
      .single()

    if (invoiceError || !invoice) {
      return NextResponse.json(
        { 
          success: false,
          error: "Invoice not found",
          message: "Invoice not found"
        },
        { status: 404 }
      )
    }

    // Validate invoice has required fields
    if (!invoice.business_id) {
      console.error("Invoice missing business_id:", invoice.id)
      return NextResponse.json(
        { 
          success: false,
          error: "Invoice is missing business information. Please contact support.",
          message: "Invalid invoice configuration"
        },
        { status: 400 }
      )
    }

    const invoiceTotal = Number(invoice.total) || 0
    if (isNaN(invoiceTotal) || invoiceTotal <= 0) {
      console.error("Invalid invoice total:", invoice.total, "for invoice:", invoice.id)
      return NextResponse.json(
        { 
          success: false,
          error: "Invoice has an invalid total amount",
          message: "Invalid invoice amount"
        },
        { status: 400 }
      )
    }

    // Load business to check country eligibility
    const { data: business } = await supabase
      .from("businesses")
      .select("id, address_country")
      .eq("id", invoice.business_id)
      .single()

    if (!business) {
      return NextResponse.json(
        { 
          success: false,
          error: "Business not found",
          message: "Business not found"
        },
        { status: 404 }
      )
    }

    // Check provider eligibility by country
    const countryCode = normalizeCountry(business.address_country)
    
    // Map provider to eligibility provider name
    const providerMap: Record<string, "mtn_momo" | "hubtel"> = {
      "mtn": "mtn_momo",
      "vodafone": "mtn_momo", // Vodafone uses MTN MoMo API in Ghana
      "airteltigo": "mtn_momo", // AirtelTigo uses MTN MoMo API in Ghana
    }
    
    const eligibilityProvider = providerMap[provider]
    
    if (eligibilityProvider) {
      try {
        assertProviderAllowed(countryCode, eligibilityProvider)
      } catch (error: any) {
        return NextResponse.json(
          { 
            success: false,
            error: error.message || "Payment method/provider not available for your country.",
            message: error.message || "Payment method/provider not available for your country."
          },
          { status: 403 }
        )
      }
    }

    if (invoice.status === "paid") {
      return NextResponse.json(
        { 
          success: false,
          error: "This invoice has already been paid",
          message: "Invoice already paid"
        },
        { status: 400 }
      )
    }

    // Calculate remaining balance
    const { data: payments, error: paymentsError } = await supabase
      .from("payments")
      .select("amount")
      .eq("invoice_id", invoice_id)
      .is("deleted_at", null)

    if (paymentsError) {
      console.error("Error fetching existing payments:", paymentsError)
      // Don't fail - just assume no payments yet
    }

    const totalPaid = payments?.reduce((sum, p) => sum + Number(p.amount || 0), 0) || 0
    const remainingBalance = invoiceTotal - totalPaid

    if (remainingBalance <= 0) {
      return NextResponse.json(
        { 
          success: false,
          error: "Invoice balance is already zero",
          message: "No balance remaining"
        },
        { status: 400 }
      )
    }

    const { error: bootstrapErr } = await ensureAccountingInitialized(supabase, invoice.business_id)
    if (bootstrapErr) {
      return NextResponse.json(
        {
          success: false,
          error: bootstrapErr,
          message: "Accounting must be initialized before recording payments. Please try again or contact support.",
        },
        { status: 500 }
      )
    }

    // Validate phone number
    if (!phone_number || typeof phone_number !== "string") {
      return NextResponse.json(
        { 
          success: false,
          error: "Invalid phone number format",
          message: "Phone number is required and must be a string"
        },
        { status: 400 }
      )
    }

    // Format phone number (remove spaces, ensure it starts with country code)
    const cleanPhone = phone_number.replace(/\s+/g, "").replace(/^0/, "+233")
    
    // Generate unique reference
    const reference = `INV-${invoice.invoice_number}-${Date.now()}`

    // For now, we'll simulate the MoMo API call
    // In production, you would make actual API calls to MTN MoMo API
    // This is a placeholder implementation

    let momoResponse: any = null
    let momoError: string | null = null

    if (provider === "mtn" && MTN_MOMO_API_KEY) {
      try {
        // TODO: Implement actual MTN MoMo API integration
        // Step 1: Get access token from MTN MoMo API
        // POST https://sandbox.momodeveloper.mtn.com/collection/token/
        // Headers: Authorization: Basic {base64(userId:primaryKey)}, Ocp-Apim-Subscription-Key: {apiKey}
        // Response: { access_token, expires_in }
        
        // Step 2: Initiate request-to-pay
        // POST https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay
        // Headers: 
        //   Authorization: Bearer {access_token}
        //   X-Target-Environment: sandbox (or production)
        //   X-Reference-Id: {reference}
        //   Ocp-Apim-Subscription-Key: {apiKey}
        // Body: {
        //   amount: "{amount}",
        //   currency: "GHS",
        //   externalId: "{reference}",
        //   payer: {
        //     partyIdType: "MSISDN",
        //     partyId: "{cleanPhone}"
        //   },
        //   payerMessage: "Payment for invoice #{invoice_number}",
        //   payeeNote: "Invoice payment"
        // }
        
        // For now, we'll create a pending payment record
        // In production, replace this with actual API calls above
        
        momoResponse = {
          status: "PENDING",
          reference: reference,
          message: "Payment request sent. Please approve on your phone."
        }
      } catch (err: any) {
        momoError = err.message || "Failed to initiate MTN MoMo payment"
      }
    } else if (provider === "vodafone") {
      // TODO: Implement Vodafone Cash API integration
      momoResponse = {
        status: "PENDING",
        reference: reference,
        message: "Payment request initiated. Please complete on your phone."
      }
    } else if (provider === "airteltigo") {
      // TODO: Implement AirtelTigo Money API integration
      momoResponse = {
        status: "PENDING",
        reference: reference,
        message: "Payment request initiated. Please complete on your phone."
      }
    } else {
      // Fallback for when provider API is not configured
      momoResponse = {
        status: "PENDING",
        reference: reference,
        message: "Payment request initiated. Please complete on your phone."
      }
    }

    if (momoError) {
      return NextResponse.json(
        { 
          success: false,
          error: momoError,
          message: "Payment initiation failed"
        },
        { status: 500 }
      )
    }

    // Validate remaining balance is valid (already done above, but keep for safety)
    // The actual validation is now done just before creating paymentData

    // Create a pending payment record
    // Ensure amount is a valid number (not string)
    const paymentAmount = Number(remainingBalance);
    if (isNaN(paymentAmount) || paymentAmount <= 0) {
      return NextResponse.json(
        { 
          success: false,
          error: "Invalid payment amount calculated",
          message: `Payment amount calculation error: remainingBalance=${remainingBalance}, invoiceTotal=${invoiceTotal}, totalPaid=${totalPaid}`
        },
        { status: 400 }
      )
    }

    const paymentData: any = {
      business_id: invoice.business_id,
      invoice_id: invoice_id,
      amount: paymentAmount,
      date: new Date().toISOString().split("T")[0],
      method: "momo",
      notes: `Mobile Money payment via ${provider.toUpperCase()} - Pending approval`,
    }

    // Log payment data for debugging
    console.log("Creating payment with data:", {
      paymentAmount,
      remainingBalance,
      invoiceTotal,
      totalPaid,
      invoiceId: invoice_id,
      businessId: invoice.business_id
    })

    // Add reference if provided
    if (reference) {
      paymentData.reference = reference
    }

    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .insert(paymentData)
      .select()
      .single()

    if (paymentError) {
      console.error("Error creating payment record:", paymentError)
      console.error("Payment data attempted:", JSON.stringify(paymentData, null, 2))
      console.error("Full error object:", JSON.stringify(paymentError, null, 2))
      console.error("Error code:", paymentError.code)
      console.error("Error details:", paymentError.details)
      console.error("Error hint:", paymentError.hint)
      
      // Return more detailed error information
      return NextResponse.json(
        { 
          success: false,
          error: "Failed to create payment record",
          message: paymentError.message || "Database error when creating payment",
          details: paymentError.details || null,
          hint: paymentError.hint || null,
          code: paymentError.code || null,
          // Include full error in development
          ...(process.env.NODE_ENV === "development" && {
            fullError: JSON.stringify(paymentError, null, 2)
          })
        },
        { status: 500 }
      )
    }

    // Store payment reference for status tracking (you might want a separate table for this)
    // For now, we'll use the payment reference field

    return NextResponse.json({
      success: true,
      reference: reference,
      payment_id: payment.id,
      message: momoResponse.message || "Payment request sent. Please approve on your phone.",
      status: "PENDING"
    })
  } catch (error: any) {
    console.error("Error initiating MoMo payment:", error)
    console.error("Error stack:", error.stack)
    console.error("Error details:", {
      message: error.message,
      name: error.name,
      cause: error.cause
    })
    
    // Return detailed error in development, generic in production
    const errorMessage = process.env.NODE_ENV === "development" 
      ? error.message || "Internal server error"
      : "Failed to initiate payment. Please try again."
    
    return NextResponse.json(
      { 
        success: false,
        error: errorMessage,
        message: errorMessage,
        ...(process.env.NODE_ENV === "development" && {
          details: error.toString(),
          stack: error.stack?.split("\n").slice(0, 5).join("\n")
        })
      },
      { status: 500 }
    )
  }
}
