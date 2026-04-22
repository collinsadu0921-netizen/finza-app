/**
 * Copy and subject lines for proposal delivery (email + WhatsApp).
 * Public proposal page URL only — never storage paths.
 */

export type ProposalMessagingContext = {
  businessDisplayName: string
  proposalTitle: string
  proposalNumber: string | null
  customerName: string | null
  publicProposalUrl: string
  /** Proposal expires_at ISO string, if any */
  expiresAtIso: string | null
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }
  return text.replace(/[&<>"']/g, (m) => map[m])
}

/** One-line label for the proposal in subject / body (number preferred). */
export function buildProposalDocumentTitleLine(ctx: Pick<ProposalMessagingContext, "proposalTitle" | "proposalNumber">): string {
  const num = (ctx.proposalNumber || "").trim()
  if (num) return `Proposal ${num}`
  const t = (ctx.proposalTitle || "").trim()
  return t || "Proposal"
}

export function buildProposalEmailSubject(ctx: ProposalMessagingContext): string {
  const line = buildProposalDocumentTitleLine(ctx)
  return `${line} from ${ctx.businessDisplayName}`
}

export function buildProposalEmailContextLine(ctx: Pick<ProposalMessagingContext, "expiresAtIso">): string | null {
  if (!ctx.expiresAtIso) return null
  const d = new Date(ctx.expiresAtIso)
  if (Number.isNaN(d.getTime())) return null
  return `This link is offered until ${d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.`
}

/** Plain + HTML body for non–service-workspace transactional sends (Resend, business From). */
export function buildProposalTransactionalEmailHtml(ctx: ProposalMessagingContext): { html: string; text: string } {
  const titleLine = buildProposalDocumentTitleLine(ctx)
  const greeting = ctx.customerName?.trim() ? `Hi ${escapeHtml(ctx.customerName.trim())},` : "Hello,"
  const ctxLine = buildProposalEmailContextLine(ctx)
  const ctxHtml =
    ctxLine && ctxLine.trim()
      ? `<p style="margin:12px 0 0;font-size:15px;color:#334155;">${escapeHtml(ctxLine.trim())}</p>`
      : ""
  const url = ctx.publicProposalUrl

  const html = `<!DOCTYPE html>
<html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;padding:24px;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
    <tr><td style="padding:28px 28px 8px;">
      <p style="margin:0;font-size:16px;color:#0f172a;">${greeting}</p>
      <p style="margin:16px 0 0;font-size:15px;line-height:1.55;color:#334155;">
        <strong>${escapeHtml(ctx.businessDisplayName)}</strong> has shared <strong>${escapeHtml(titleLine)}</strong> with you. Please review it online when you have a moment.
      </p>
      ${ctxHtml}
    </td></tr>
    <tr><td style="padding:8px 28px 28px;">
      <a href="${escapeHtml(url)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px;">View proposal</a>
      <p style="margin:20px 0 0;font-size:13px;color:#64748b;">If the button doesn’t work, copy this link:</p>
      <p style="margin:6px 0 0;font-size:13px;word-break:break-all;"><a href="${escapeHtml(url)}" style="color:#2563eb;">${escapeHtml(url)}</a></p>
    </td></tr>
  </table>
  <p style="max-width:560px;margin:16px auto 0;font-size:12px;color:#94a3b8;text-align:center;">You’re receiving this because you are listed as the client contact for this proposal.</p>
</body></html>`

  const textGreeting = ctx.customerName?.trim() ? `Hi ${ctx.customerName.trim()},` : "Hello,"
  const text = `${textGreeting}

${ctx.businessDisplayName} has shared ${titleLine} with you. Please review it online:
${url}
${ctxLine ? `\n${ctxLine}\n` : ""}
`

  return { html, text }
}

/**
 * Short WhatsApp message; must stay within practical limits for wa.me links.
 */
export function buildProposalWhatsAppMessage(ctx: ProposalMessagingContext): string {
  const titleLine = buildProposalDocumentTitleLine(ctx)
  const who = ctx.customerName?.trim() ? `Hi ${ctx.customerName.trim()}` : "Hello"
  const ctxLine = buildProposalEmailContextLine(ctx)
  const expiryBit = ctxLine ? `\n\n${ctxLine}` : ""
  return `${who}, ${ctx.businessDisplayName} has shared ${titleLine} with you. View it here:\n\n${ctx.publicProposalUrl}${expiryBit}`
}

/**
 * WhatsApp deep link: prefer wa.me/{digits} when phone is valid; otherwise open app with message only.
 */
export function buildProposalWhatsAppUrl(message: string, phone: string | null | undefined): string {
  const trimmed = (phone || "").trim()
  if (!trimmed) {
    return `https://wa.me/?text=${encodeURIComponent(message)}`
  }
  const digits = trimmed.startsWith("+")
    ? trimmed.slice(1).replace(/\D/g, "")
    : trimmed.replace(/\D/g, "")
  if (digits.length >= 8) {
    return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
  }
  return `https://wa.me/?text=${encodeURIComponent(message)}`
}
