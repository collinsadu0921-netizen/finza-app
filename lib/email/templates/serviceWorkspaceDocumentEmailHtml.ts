/**
 * Simple transactional HTML for Service workspace: invoice, quote (estimate), proforma.
 * No line items — CTA links to the public document page.
 */

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

export type ServiceWorkspaceDocumentEmailKind = "invoice" | "quote" | "proforma"

const CTA_LABEL: Record<ServiceWorkspaceDocumentEmailKind, string> = {
  invoice: "View invoice",
  quote: "View quote",
  proforma: "View proforma",
}

export function buildServiceWorkspaceDocumentEmailHtml(opts: {
  kind: ServiceWorkspaceDocumentEmailKind
  businessName: string
  customerName?: string | null
  /** e.g. "Invoice #12" or "Quote Q-004" or "Proforma PRF-2" */
  documentTitleLine: string
  /** Optional line under title, e.g. due date */
  contextLine?: string | null
  publicUrl: string
}): { html: string; text: string } {
  const greeting = opts.customerName?.trim()
    ? `Hi ${escapeHtml(opts.customerName.trim())},`
    : "Hello,"
  const cta = CTA_LABEL[opts.kind]
  const ctx =
    opts.contextLine && opts.contextLine.trim()
      ? `<p style="margin:12px 0 0;font-size:15px;color:#334155;">${escapeHtml(opts.contextLine.trim())}</p>`
      : ""

  const html = `<!DOCTYPE html>
<html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;padding:24px;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
    <tr><td style="padding:28px 28px 8px;">
      <p style="margin:0;font-size:16px;color:#0f172a;">${greeting}</p>
      <p style="margin:16px 0 0;font-size:15px;line-height:1.55;color:#334155;">
        <strong>${escapeHtml(opts.businessName)}</strong> has shared a <strong>${escapeHtml(opts.documentTitleLine)}</strong> with you in Finza.
      </p>
      ${ctx}
    </td></tr>
    <tr><td style="padding:8px 28px 28px;">
      <a href="${escapeHtml(opts.publicUrl)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px;">${escapeHtml(cta)}</a>
      <p style="margin:20px 0 0;font-size:13px;color:#64748b;">If the button doesn’t work, copy this link:</p>
      <p style="margin:6px 0 0;font-size:13px;word-break:break-all;"><a href="${escapeHtml(opts.publicUrl)}" style="color:#2563eb;">${escapeHtml(opts.publicUrl)}</a></p>
    </td></tr>
  </table>
  <p style="max-width:560px;margin:16px auto 0;font-size:12px;color:#94a3b8;text-align:center;">You’re receiving this because you are listed as the client contact on this document.</p>
</body></html>`

  const text = `${opts.customerName?.trim() ? `Hi ${opts.customerName.trim()},` : "Hello,"}

${opts.businessName} has shared ${opts.documentTitleLine} with you in Finza.
${opts.contextLine?.trim() ? `${opts.contextLine.trim()}\n` : ""}
${cta}: ${opts.publicUrl}
`

  return { html, text }
}
