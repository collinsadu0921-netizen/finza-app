/**
 * Payslip email HTML template.
 * Professional layout: branded header, earnings breakdown, deductions, net pay, view link.
 */

function escHtml(text: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }
  return String(text).replace(/[&<>"']/g, (m) => map[m])
}

function fmt(amount: number, symbol: string): string {
  return `${escHtml(symbol)}${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
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
  const sym = p.currencySymbol

  const bankRow =
    p.bankName || p.bankAccount
      ? `<tr>
          <td style="padding:8px 0 0;font-size:13px;color:#6b7280;border-top:1px solid #e5e7eb;margin-top:8px;">Payment to</td>
          <td style="padding:8px 0 0;font-size:13px;color:#374151;text-align:right;border-top:1px solid #e5e7eb;">
            ${escHtml(p.bankName ?? "")}${p.bankAccount ? ` &mdash; ${escHtml(p.bankAccount)}` : ""}
          </td>
        </tr>`
      : ""

  const totalDeductions = p.paye + p.ssnitEmployee + p.deductionsTotal
  const bonusAmount = Number(p.bonusAmount ?? 0)
  const overtimeAmount = Number(p.overtimeAmount ?? 0)
  const regularAllowancesAmount = Math.max(0, Number(p.regularAllowancesAmount ?? p.allowancesTotal - bonusAmount - overtimeAmount))

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

          <!-- Branded header -->
          <tr>
            <td style="background:linear-gradient(135deg,#0f2d5c 0%,#1d4ed8 100%);border-radius:12px 12px 0 0;padding:32px 36px 28px;">
              <p style="margin:0 0 2px;font-size:11px;font-weight:700;color:#93c5fd;letter-spacing:.1em;text-transform:uppercase;">Payslip</p>
              <h1 style="margin:0 0 4px;font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-.3px;">${escHtml(p.payrollMonth)}</h1>
              <p style="margin:0;font-size:13px;color:#bfdbfe;">${escHtml(p.businessName)}</p>
            </td>
          </tr>

          <!-- Main card -->
          <tr>
            <td style="background:#ffffff;padding:28px 36px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">

              <!-- Employee info -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;padding-bottom:20px;border-bottom:1px solid #f3f4f6;">
                <tr>
                  <td>
                    <p style="margin:0;font-size:17px;font-weight:700;color:#111827;">${escHtml(p.staffName)}</p>
                    ${p.position ? `<p style="margin:3px 0 0;font-size:13px;color:#6b7280;">${escHtml(p.position)}</p>` : ""}
                  </td>
                  <td style="text-align:right;">
                    <p style="margin:0;font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:.06em;text-transform:uppercase;">Pay period</p>
                    <p style="margin:2px 0 0;font-size:13px;color:#374151;font-weight:500;">${escHtml(p.payrollMonth)}</p>
                  </td>
                </tr>
              </table>

              <!-- Earnings -->
              <p style="margin:0 0 10px;font-size:11px;font-weight:700;color:#9ca3af;letter-spacing:.08em;text-transform:uppercase;">Earnings</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;">
                <tr>
                  <td style="padding:9px 0;font-size:14px;color:#374151;border-bottom:1px solid #f9fafb;">Basic Salary</td>
                  <td style="padding:9px 0;font-size:14px;color:#111827;font-weight:500;text-align:right;border-bottom:1px solid #f9fafb;">${fmt(p.basicSalary, sym)}</td>
                </tr>
                ${regularAllowancesAmount > 0 ? `
                <tr>
                  <td style="padding:9px 0;font-size:14px;color:#374151;border-bottom:1px solid #f9fafb;">Recurring Allowances</td>
                  <td style="padding:9px 0;font-size:14px;color:#111827;font-weight:500;text-align:right;border-bottom:1px solid #f9fafb;">${fmt(regularAllowancesAmount, sym)}</td>
                </tr>` : ""}
                ${bonusAmount > 0 ? `
                <tr>
                  <td style="padding:9px 0;font-size:14px;color:#374151;border-bottom:1px solid #f9fafb;">Bonus</td>
                  <td style="padding:9px 0;font-size:14px;color:#111827;font-weight:500;text-align:right;border-bottom:1px solid #f9fafb;">${fmt(bonusAmount, sym)}</td>
                </tr>` : ""}
                ${overtimeAmount > 0 ? `
                <tr>
                  <td style="padding:9px 0;font-size:14px;color:#374151;border-bottom:1px solid #f9fafb;">Overtime</td>
                  <td style="padding:9px 0;font-size:14px;color:#111827;font-weight:500;text-align:right;border-bottom:1px solid #f9fafb;">${fmt(overtimeAmount, sym)}</td>
                </tr>` : ""}
                <tr>
                  <td style="padding:10px 0;font-size:14px;font-weight:700;color:#111827;">Gross Pay</td>
                  <td style="padding:10px 0;font-size:14px;font-weight:700;color:#111827;text-align:right;">${fmt(p.grossSalary, sym)}</td>
                </tr>
              </table>

              <!-- Deductions -->
              ${totalDeductions > 0 ? `
              <p style="margin:0 0 10px;font-size:11px;font-weight:700;color:#9ca3af;letter-spacing:.08em;text-transform:uppercase;">Deductions</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;">
                ${p.paye > 0 ? `
                <tr>
                  <td style="padding:9px 0;font-size:14px;color:#374151;border-bottom:1px solid #f9fafb;">PAYE Income Tax</td>
                  <td style="padding:9px 0;font-size:14px;color:#dc2626;font-weight:500;text-align:right;border-bottom:1px solid #f9fafb;">&minus;${fmt(p.paye, sym)}</td>
                </tr>` : ""}
                ${p.ssnitEmployee > 0 ? `
                <tr>
                  <td style="padding:9px 0;font-size:14px;color:#374151;border-bottom:1px solid #f9fafb;">SSNIT (Employee 5.5%)</td>
                  <td style="padding:9px 0;font-size:14px;color:#dc2626;font-weight:500;text-align:right;border-bottom:1px solid #f9fafb;">&minus;${fmt(p.ssnitEmployee, sym)}</td>
                </tr>` : ""}
                ${p.deductionsTotal > 0 ? `
                <tr>
                  <td style="padding:9px 0;font-size:14px;color:#374151;border-bottom:1px solid #f9fafb;">Other Deductions</td>
                  <td style="padding:9px 0;font-size:14px;color:#dc2626;font-weight:500;text-align:right;border-bottom:1px solid #f9fafb;">&minus;${fmt(p.deductionsTotal, sym)}</td>
                </tr>` : ""}
                <tr>
                  <td style="padding:10px 0;font-size:14px;font-weight:700;color:#111827;">Total Deductions</td>
                  <td style="padding:10px 0;font-size:14px;font-weight:700;color:#dc2626;text-align:right;">&minus;${fmt(totalDeductions, sym)}</td>
                </tr>
              </table>` : ""}

              <!-- Net Pay -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;border-collapse:collapse;">
                <tr>
                  <td style="padding:18px 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="font-size:15px;font-weight:700;color:#166534;">Net Pay</td>
                        <td style="font-size:26px;font-weight:800;color:#15803d;text-align:right;letter-spacing:-.5px;">${fmt(p.netSalary, sym)}</td>
                      </tr>
                      ${bankRow}
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
                <tr>
                  <td align="center">
                    <a href="${escHtml(p.publicUrl)}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:13px 32px;border-radius:8px;letter-spacing:.01em;">View full payslip</a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
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
