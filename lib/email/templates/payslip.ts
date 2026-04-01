/**
 * Payslip email HTML — notification only (no pay figures).
 * Full breakdown appears after the recipient opens the secure payslip link.
 */

function escHtml(text: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }
  return String(text).replace(/[&<>"']/g, (m) => map[m])
}

export interface PayslipEmailParams {
  staffName: string
  payrollMonth: string
  businessName: string
  currencySymbol: string
  basicSalary: number
  allowancesTotal: number
  regularAllowancesAmount?: number
  bonusAmount?: number
  overtimeAmount?: number
  deductionsTotal: number
  grossSalary: number
  ssnitEmployee: number
  paye: number
  bonusTax5?: number
  bonusTaxGraduated?: number
  overtimeTax5?: number
  overtimeTax10?: number
  overtimeTaxGraduated?: number
  netSalary: number
  publicUrl: string
  position?: string
  bankName?: string
  bankAccount?: string
}

export function buildPayslipEmailHtml(p: PayslipEmailParams): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>Payslip &mdash; ${escHtml(p.payrollMonth)}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;">
          <tr>
            <td style="background:linear-gradient(135deg,#0f2d5c 0%,#1d4ed8 100%);border-radius:12px 12px 0 0;padding:32px 36px 28px;">
              <p style="margin:0 0 2px;font-size:11px;font-weight:700;color:#93c5fd;letter-spacing:.1em;text-transform:uppercase;">Payslip</p>
              <h1 style="margin:0 0 4px;font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-.3px;">${escHtml(p.payrollMonth)}</h1>
              <p style="margin:0;font-size:13px;color:#bfdbfe;">${escHtml(p.businessName)}</p>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:28px 36px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">
              <p style="margin:0 0 8px;font-size:15px;color:#374151;line-height:1.6;">Hello ${escHtml(p.staffName)},</p>
              <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">Your payslip for <strong>${escHtml(p.payrollMonth)}</strong> from ${escHtml(p.businessName)} is ready. Open the link below to view your full payslip.</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">
                <tr>
                  <td align="center">
                    <a href="${escHtml(p.publicUrl)}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:13px 32px;border-radius:8px;letter-spacing:.01em;">View full payslip</a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:15px;color:#374151;line-height:1.6;">Thank you,<br />${escHtml(p.businessName)}</p>
            </td>
          </tr>
          <tr>
            <td style="background:#f9fafb;padding:16px 36px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:12px;color:#9ca3af;">
                    This payslip was issued by <strong style="color:#6b7280;">${escHtml(p.businessName)}</strong>. Please do not reply to this email.
                  </td>
                  <td style="font-size:12px;color:#d1d5db;text-align:right;white-space:nowrap;">
                    Powered by <strong style="color:#6b7280;">Finza</strong>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
