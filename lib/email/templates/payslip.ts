/**
 * Payslip email HTML template.
 * Clean, professional layout: header, earnings breakdown, deductions, net pay, view link.
 */

function escHtml(text: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }
  return String(text).replace(/[&<>"']/g, (m) => map[m])
}

function fmt(amount: number, symbol: string): string {
  return `${escHtml(symbol)}${Number(amount).toFixed(2)}`
}

export interface PayslipEmailParams {
  staffName: string
  payrollMonth: string
  businessName: string
  currencySymbol: string
  basicSalary: number
  allowancesTotal: number
  deductionsTotal: number
  grossSalary: number
  ssnitEmployee: number
  paye: number
  netSalary: number
  publicUrl: string
  position?: string
  bankName?: string
  bankAccount?: string
}

export function buildPayslipEmailHtml(p: PayslipEmailParams): string {
  const sym = p.currencySymbol

  const bankRow =
    p.bankName || p.bankAccount
      ? `<tr>
          <td style="padding:6px 0;color:#6b7280;font-size:13px;">Payment to</td>
          <td style="padding:6px 0;color:#111827;font-size:13px;text-align:right;">
            ${escHtml(p.bankName ?? "")}${p.bankAccount ? ` — ${escHtml(p.bankAccount)}` : ""}
          </td>
        </tr>`
      : ""

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>Payslip — ${escHtml(p.payrollMonth)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:system-ui,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);padding:28px 32px;">
              <p style="margin:0;color:#bfdbfe;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;">Payslip</p>
              <h1 style="margin:4px 0 0;color:#ffffff;font-size:22px;font-weight:700;">${escHtml(p.payrollMonth)}</h1>
              <p style="margin:6px 0 0;color:#93c5fd;font-size:13px;">${escHtml(p.businessName)}</p>
            </td>
          </tr>

          <!-- Employee info -->
          <tr>
            <td style="padding:24px 32px 0;">
              <p style="margin:0;font-size:16px;font-weight:700;color:#111827;">${escHtml(p.staffName)}</p>
              ${p.position ? `<p style="margin:2px 0 0;font-size:13px;color:#6b7280;">${escHtml(p.position)}</p>` : ""}
            </td>
          </tr>

          <!-- Earnings -->
          <tr>
            <td style="padding:20px 32px 0;">
              <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#6b7280;letter-spacing:.08em;text-transform:uppercase;">Earnings</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr>
                  <td style="padding:7px 0;font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6;">Basic Salary</td>
                  <td style="padding:7px 0;font-size:13px;color:#111827;text-align:right;border-bottom:1px solid #f3f4f6;">${fmt(p.basicSalary, sym)}</td>
                </tr>
                ${p.allowancesTotal > 0 ? `
                <tr>
                  <td style="padding:7px 0;font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6;">Allowances</td>
                  <td style="padding:7px 0;font-size:13px;color:#111827;text-align:right;border-bottom:1px solid #f3f4f6;">${fmt(p.allowancesTotal, sym)}</td>
                </tr>` : ""}
                <tr>
                  <td style="padding:9px 0;font-size:14px;font-weight:700;color:#111827;">Gross Pay</td>
                  <td style="padding:9px 0;font-size:14px;font-weight:700;color:#111827;text-align:right;">${fmt(p.grossSalary, sym)}</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Deductions -->
          <tr>
            <td style="padding:20px 32px 0;">
              <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#6b7280;letter-spacing:.08em;text-transform:uppercase;">Deductions</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                ${p.paye > 0 ? `
                <tr>
                  <td style="padding:7px 0;font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6;">PAYE Income Tax</td>
                  <td style="padding:7px 0;font-size:13px;color:#dc2626;text-align:right;border-bottom:1px solid #f3f4f6;">−${fmt(p.paye, sym)}</td>
                </tr>` : ""}
                ${p.ssnitEmployee > 0 ? `
                <tr>
                  <td style="padding:7px 0;font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6;">SSNIT (Employee 5.5%)</td>
                  <td style="padding:7px 0;font-size:13px;color:#dc2626;text-align:right;border-bottom:1px solid #f3f4f6;">−${fmt(p.ssnitEmployee, sym)}</td>
                </tr>` : ""}
                ${p.deductionsTotal > 0 ? `
                <tr>
                  <td style="padding:7px 0;font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6;">Other Deductions</td>
                  <td style="padding:7px 0;font-size:13px;color:#dc2626;text-align:right;border-bottom:1px solid #f3f4f6;">−${fmt(p.deductionsTotal, sym)}</td>
                </tr>` : ""}
              </table>
            </td>
          </tr>

          <!-- Net Pay -->
          <tr>
            <td style="padding:20px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border-radius:8px;border:1px solid #bbf7d0;padding:16px;">
                <tr>
                  <td style="padding:0;font-size:15px;font-weight:700;color:#166534;">Net Pay</td>
                  <td style="padding:0;font-size:22px;font-weight:800;color:#15803d;text-align:right;">${fmt(p.netSalary, sym)}</td>
                </tr>
                ${bankRow}
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td style="padding:0 32px 28px;text-align:center;">
              <a href="${escHtml(p.publicUrl)}"
                 style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;">
                View Full Payslip
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center;">
                This payslip was generated by ${escHtml(p.businessName)} via Finza. Do not reply to this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
