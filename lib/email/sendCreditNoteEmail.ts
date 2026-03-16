/**
 * Send credit note by email.
 * Uses Resend API when RESEND_API_KEY is set; otherwise logs (same pattern as invoice send).
 * Server-side only.
 */

const RESEND_API = "https://api.resend.com/emails"

export interface SendCreditNoteEmailParams {
  to: string
  businessName: string
  creditNumber: string
  invoiceReference: string
  creditAmount: number
  reason: string
  customerName: string
  publicUrl: string
}

function buildCreditNoteEmailHtml(params: SendCreditNoteEmailParams): string {
  const {
    businessName,
    creditNumber,
    invoiceReference,
    creditAmount,
    reason,
    customerName,
    publicUrl,
  } = params
  const amountStr = creditAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Credit Note ${creditNumber}</title>
</head>
<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);overflow:hidden;">
    <div style="padding:24px 24px 16px;border-bottom:1px solid #eee;">
      <p style="margin:0;font-size:14px;color:#666;">${businessName}</p>
      <h1 style="margin:8px 0 0;font-size:20px;font-weight:600;color:#111;">Credit Note #${creditNumber}</h1>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 16px;font-size:15px;color:#333;">Hello ${customerName},</p>
      <p style="margin:0 0 16px;font-size:15px;color:#333;">Please find your credit note details below.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:8px 0;font-size:14px;color:#666;">Invoice reference</td><td style="padding:8px 0;font-size:14px;text-align:right;font-weight:500;">#${invoiceReference || "—"}</td></tr>
        <tr><td style="padding:8px 0;font-size:14px;color:#666;">Credit amount</td><td style="padding:8px 0;font-size:14px;text-align:right;color:#b91c1c;font-weight:600;">−${amountStr}</td></tr>
        ${reason ? `<tr><td style="padding:8px 0;font-size:14px;color:#666;">Reason</td><td style="padding:8px 0;font-size:14px;text-align:right;">${reason}</td></tr>` : ""}
      </table>
      <p style="margin:16px 0 0;font-size:13px;color:#666;">This credit reduces the balance on the linked invoice. Any remaining balance is still due.</p>
      ${publicUrl ? `<p style="margin:20px 0 0;"><a href="${publicUrl}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;">View credit note</a></p>` : ""}
    </div>
    <div style="padding:16px 24px;background:#f9fafb;font-size:12px;color:#6b7280;">
      ${businessName} — Credit Note ${creditNumber}
    </div>
  </div>
</body>
</html>
  `.trim()
}

function buildCreditNoteEmailText(params: SendCreditNoteEmailParams): string {
  const {
    businessName,
    creditNumber,
    invoiceReference,
    creditAmount,
    reason,
    customerName,
    publicUrl,
  } = params
  const amountStr = creditAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const lines: string[] = [
    `${businessName}`,
    `Credit Note #${creditNumber}`,
    "",
    `Hello ${customerName},`,
    "Please find your credit note details below.",
    "",
    `Invoice reference: #${invoiceReference || "—"}`,
    `Credit amount: −${amountStr}`,
    ...(reason ? [`Reason: ${reason}`] : []),
    "",
    "This credit reduces the balance on the linked invoice. Any remaining balance is still due.",
    ...(publicUrl ? ["", `View credit note: ${publicUrl}`] : []),
    "",
    `${businessName} — Credit Note ${creditNumber}`,
  ]
  return lines.join("\n")
}

/**
 * Send credit note email. Uses Resend when RESEND_API_KEY is set; otherwise no-op (logs in dev).
 * Does not throw; returns void.
 */
export async function sendCreditNoteEmail(params: SendCreditNoteEmailParams): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    if (process.env.NODE_ENV === "development") {
      console.log("[sendCreditNoteEmail] RESEND_API_KEY not set; would send to:", params.to)
    }
    return
  }
  const from = process.env.RESEND_FROM ?? "Finza <onboarding@resend.dev>"
  const subject = `Credit Note #${params.creditNumber} from ${params.businessName}`
  const html = buildCreditNoteEmailHtml(params)
  const text = buildCreditNoteEmailText(params)
  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject,
        html,
        text,
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      console.error("[sendCreditNoteEmail] Resend failed:", res.status, err)
    }
  } catch (err) {
    console.error("[sendCreditNoteEmail] Error:", err)
  }
}
