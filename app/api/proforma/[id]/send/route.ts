import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabaseServer"
import { resolveBusinessScopeForUser } from "@/lib/business"
import { createAuditLog } from "@/lib/auditLog"
import { sendServiceWorkspaceDocumentEmail } from "@/lib/email/sendServiceWorkspaceDocumentEmail"

type ProformaRow = Record<string, unknown> & {
  id: string
  business_id: string
  status: string
  proforma_number?: string | null
  public_token?: string | null
  issue_date?: string | null
  validity_date?: string | null
  customers?: { name?: string | null; email?: string | null } | null
  businesses?: {
    email?: string | null
    industry?: string | null
    legal_name?: string | null
    trading_name?: string | null
  } | null
}

async function loadProformaForSend(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  proformaId: string,
  businessId: string
) {
  const { data, error } = await supabase
    .from("proforma_invoices")
    .select(
      `
      *,
      customers ( id, name, email, phone, whatsapp_phone )
    `
    )
    .eq("id", proformaId)
    .eq("business_id", businessId)
    .is("deleted_at", null)
    .single()
  if (error || !data) return { row: null as ProformaRow | null, error }

  const { data: biz } = await supabase
    .from("businesses")
    .select("id, email, industry, legal_name, trading_name")
    .eq("id", businessId)
    .maybeSingle()

  const row = { ...(data as Record<string, unknown>), businesses: biz ?? null } as ProformaRow
  return { row, error: null }
}

function proformaPublicUrl(request: NextRequest, publicToken: string): string {
  let base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  try {
    if (request.url) {
      const o = new URL(request.url).origin
      if (o) base = o
    }
  } catch {
    /* keep */
  }
  return `${base}/proforma-public/${publicToken}`
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const proformaId = resolvedParams.id

    if (!proformaId) {
      return NextResponse.json({ error: "Proforma invoice ID is required" }, { status: 400 })
    }

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const requestedBusinessId =
      (typeof body.business_id === "string" && body.business_id.trim()) ||
      new URL(request.url).searchParams.get("business_id") ||
      undefined
    const emailOnly = body.email_only === true || body.emailOnly === true
    const sendEmailAfter =
      body.send_email === true || body.sendEmail === true || body.send_email === "true"

    const scope = await resolveBusinessScopeForUser(supabase, user.id, requestedBusinessId)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    const { row: proforma, error: proformaError } = await loadProformaForSend(supabase, proformaId, scope.businessId)
    if (proformaError || !proforma) {
      return NextResponse.json({ error: "Proforma invoice not found" }, { status: 404 })
    }

    const industry = proforma.businesses?.industry ?? null
    const isServiceWorkspace = industry === "service"

    /** Resend client email only — proforma must already be sent (Service workspace). */
    if (emailOnly) {
      if (!isServiceWorkspace) {
        return NextResponse.json(
          { success: false, error: "Email resend is only available for service businesses." },
          { status: 400 }
        )
      }
      if (proforma.status !== "sent") {
        return NextResponse.json(
          { success: false, error: "Only sent proformas can resend email from this action." },
          { status: 400 }
        )
      }
      const token = proforma.public_token
      if (!token) {
        return NextResponse.json(
          { success: false, error: "This proforma has no public link yet." },
          { status: 400 }
        )
      }
      const custEmail = proforma.customers?.email?.trim()
      if (!custEmail) {
        return NextResponse.json(
          {
            success: false,
            error: "Customer email address is not available. Please add an email to the customer profile.",
          },
          { status: 400 }
        )
      }
      const businessName =
        proforma.businesses?.trading_name?.trim() ||
        proforma.businesses?.legal_name?.trim() ||
        "Our Business"
      const businessEmail = proforma.businesses?.email?.trim() ?? ""
      const publicUrl = proformaPublicUrl(request, token)
      const prf = proforma.proforma_number ? `PRF ${proforma.proforma_number}` : "Proforma"
      const result = await sendServiceWorkspaceDocumentEmail({
        to: custEmail,
        replyTo: businessEmail,
        subject: `${proforma.proforma_number ? `Proforma Invoice ${proforma.proforma_number}` : "Proforma invoice"} from ${businessName}`,
        kind: "proforma",
        businessName,
        customerName: proforma.customers?.name ?? null,
        documentTitleLine: proforma.proforma_number ? `Proforma ${proforma.proforma_number}` : "Proforma invoice",
        contextLine: proforma.validity_date
          ? `Valid until: ${new Date(String(proforma.validity_date)).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}`
          : null,
        publicUrl,
        meta: { documentType: "proforma", documentId: proformaId, businessId: scope.businessId },
      })
      if (!result.success) {
        const noKey = result.reason === "no_api_key"
        const userMessage = noKey
          ? "Email is not configured. Add RESEND_API_KEY to your environment and redeploy."
          : String(result.reason || "Email delivery failed")
        return NextResponse.json({ success: false, error: userMessage, message: userMessage }, { status: 502 })
      }
      await createAuditLog({
        businessId: scope.businessId,
        userId: user.id,
        actionType: "proforma.resent_email",
        entityType: "proforma_invoice",
        entityId: proformaId,
        newValues: {
          sent_via: "email",
          resend_message_id: result.id,
          email_channel: "service_documents",
        },
        description: `Resent proforma ${proforma.proforma_number ?? proformaId} via email`,
        request,
      })
      return NextResponse.json({ success: true, message: "Proforma email sent to your client.", emailed: true })
    }

    if (proforma.status !== "draft") {
      return NextResponse.json({ error: "Only draft proformas can be sent" }, { status: 400 })
    }

    let proformaNumber = proforma.proforma_number
    if (!proformaNumber) {
      const { data: proformaNumData } = await supabase.rpc("generate_proforma_number", {
        p_business_id: scope.businessId,
      })
      proformaNumber = proformaNumData || null
      if (!proformaNumber) {
        return NextResponse.json(
          { success: false, error: "Failed to generate proforma number. Please try again." },
          { status: 500 }
        )
      }
    }

    const { data: updatedProforma, error: updateError } = await supabase
      .from("proforma_invoices")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        proforma_number: proformaNumber,
      })
      .eq("id", proformaId)
      .select()
      .single()

    if (updateError || !updatedProforma) {
      console.error("Error sending proforma invoice:", updateError)
      return NextResponse.json(
        {
          success: false,
          error: "Proforma invoice could not be sent. Please try again.",
          message: updateError?.message,
        },
        { status: 500 }
      )
    }

    let finalProforma = updatedProforma as Record<string, unknown>
    if (!finalProforma.public_token) {
      const { data: tokenData, error: tokErr } = await supabase.rpc("generate_public_token")
      if (tokErr || tokenData == null) {
        return NextResponse.json(
          { success: false, error: "Failed to generate client link for this proforma." },
          { status: 500 }
        )
      }
      const publicToken = String(tokenData)
      const { data: withTok, error: tokUpdateErr } = await supabase
        .from("proforma_invoices")
        .update({ public_token: publicToken })
        .eq("id", proformaId)
        .select()
        .single()
      if (tokUpdateErr || !withTok) {
        return NextResponse.json(
          { success: false, error: "Failed to save client link for this proforma." },
          { status: 500 }
        )
      }
      finalProforma = withTok as Record<string, unknown>
    }

    await createAuditLog({
      businessId: scope.businessId,
      userId: user?.id || null,
      actionType: "proforma.sent",
      entityType: "proforma_invoice",
      entityId: proformaId,
      oldValues: proforma,
      newValues: finalProforma,
      request,
    })

    let emailed = false
    let emailError: string | null = null
    if (sendEmailAfter && isServiceWorkspace) {
      const token = String(finalProforma.public_token || "")
      const custEmail = proforma.customers?.email?.trim()
      if (!custEmail) {
        emailError = "Customer email is missing — proforma was marked sent but no email was sent."
      } else {
        const businessName =
          proforma.businesses?.trading_name?.trim() ||
          proforma.businesses?.legal_name?.trim() ||
          "Our Business"
        const businessEmail = proforma.businesses?.email?.trim() ?? ""
        const publicUrl = proformaPublicUrl(request, token)
        const result = await sendServiceWorkspaceDocumentEmail({
          to: custEmail,
          replyTo: businessEmail,
          subject: `${proformaNumber ? `Proforma Invoice ${proformaNumber}` : "Proforma invoice"} from ${businessName}`,
          kind: "proforma",
          businessName,
          customerName: proforma.customers?.name ?? null,
          documentTitleLine: proformaNumber ? `Proforma ${proformaNumber}` : "Proforma invoice",
          contextLine: proforma.validity_date
            ? `Valid until: ${new Date(String(proforma.validity_date)).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}`
            : null,
          publicUrl,
          meta: { documentType: "proforma", documentId: proformaId, businessId: scope.businessId },
        })
        if (!result.success) {
          emailError = result.reason === "no_api_key"
            ? "Email is not configured (RESEND_API_KEY). Proforma was sent — share via WhatsApp or copy link."
            : String(result.reason || "Email delivery failed")
          console.error("[proforma/send] post-mark email failed:", result.reason)
        } else {
          emailed = true
          await createAuditLog({
            businessId: scope.businessId,
            userId: user.id,
            actionType: "proforma.sent_email",
            entityType: "proforma_invoice",
            entityId: proformaId,
            newValues: {
              resend_message_id: result.id,
              email_channel: "service_documents",
            },
            description: `Proforma ${proformaNumber ?? proformaId} emailed to ${custEmail}`,
            request,
          })
        }
      }
      if (emailError && !emailed) {
        console.warn("[proforma/send]", emailError)
      }
    }

    return NextResponse.json({
      success: true,
      proforma: finalProforma,
      emailed,
      emailWarning: emailError,
    })
  } catch (error: any) {
    console.error("Error sending proforma invoice:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Proforma invoice could not be sent. Please check your connection and try again.",
        message: error.message || "Internal server error",
      },
      { status: 500 }
    )
  }
}
