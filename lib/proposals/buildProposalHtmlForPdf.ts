import type { ProposalRenderModel } from "./renderModel"
import type { ProposalRenderSection } from "./renderModel"
import type { PricingPayload } from "./schema"
import { escapeHtml } from "./htmlEscape"
import { splitForInvestmentPlacement } from "./investmentPlacement"
import {
  PROPOSAL_PRICING_SECTION_HEADING,
  PROPOSAL_PRICING_SECTION_INTRO,
} from "./pricingSectionCopy"
import { customPricingNotesToHtml } from "./parseCustomPricing"

/** Allow only http(s) URLs for PDF embedding; strip characters that break attributes. */
function safeAttrUrl(url: string): string {
  const u = url.trim()
  if (!/^https?:\/\//i.test(u)) return ""
  return u.replace(/["']/g, "")
}

function formatMoney(amount: number, currency: string | null): string {
  const code = (currency || "").trim() || "GHS"
  try {
    return new Intl.NumberFormat("en-GH", { style: "currency", currency: code, maximumFractionDigits: 2 }).format(amount)
  } catch {
    return `${code} ${amount.toFixed(2)}`
  }
}

function pricingHtml(pricing: PricingPayload, currency: string | null): string {
  if (pricing.mode === "none") {
    return `<p class="muted doc-p">Pricing to be confirmed.</p>`
  }
  if (pricing.mode === "fixed") {
    const label = pricing.label ? escapeHtml(pricing.label) : "Total"
    return `<div class="pricing-fixed"><div class="pricing-label">${label}</div><div class="pricing-amount">${formatMoney(pricing.amount, currency)}</div></div>`
  }
  if (pricing.mode === "line_items") {
    const showDisc = pricing.items.some((it) => {
      const d = (it as { discount_amount?: number }).discount_amount
      return d != null && d > 0
    })
    const discTh = showDisc ? `<th class="num">Discount</th>` : ""
    const rows = pricing.items
      .map((it) => {
        const qty = it.quantity != null ? escapeHtml(String(it.quantity)) : "—"
        const desc = escapeHtml(it.description)
        const disc = (it as { discount_amount?: number }).discount_amount ?? 0
        const line =
          it.line_total != null
            ? it.line_total
            : it.unit_price != null && it.quantity != null
              ? it.unit_price * it.quantity - (showDisc ? disc : 0)
              : it.unit_price ?? 0
        const discCell = showDisc
          ? `<td class="num">${disc > 0 ? formatMoney(disc, currency) : "—"}</td>`
          : ""
        return `<tr><td class="td-desc">${desc}</td><td class="num">${qty}</td>${discCell}<td class="num strong">${formatMoney(Number(line), currency)}</td></tr>`
      })
      .join("")
    return `<div class="pricing-table-wrap"><table class="lines"><thead><tr><th>Description</th><th class="num">Qty</th>${discTh}<th class="num">Amount</th></tr></thead><tbody>${rows}</tbody></table></div>`
  }
  return `<div class="pricing-custom">${customPricingNotesToHtml(pricing.notes)}</div>`
}

function sectionsHtml(sections: ProposalRenderSection[]): string {
  return sections
    .map((s) => {
      switch (s.type) {
        case "heading": {
          const L = Math.min(6, Math.max(1, s.level))
          return `<h${L}>${escapeHtml(s.text)}</h${L}>`
        }
        case "paragraph":
          return `<p class="doc-p">${escapeHtml(s.text).replace(/\n/g, "<br/>")}</p>`
        case "bullet_list":
          return `<ul class="doc-ul">${s.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`
        case "image": {
          const u = safeAttrUrl(s.src)
          if (!u) return ""
          return `<figure class="fig"><img class="inline-img" src="${u}" alt="" />${
            s.caption ? `<figcaption>${escapeHtml(s.caption)}</figcaption>` : ""
          }</figure>`
        }
        case "gallery":
          return `<div class="gallery">${s.images
            .map((im) => {
              const u = safeAttrUrl(im.src)
              if (!u) return ""
              return `<figure class="fig g"><img class="inline-img" src="${u}" alt="" /></figure>`
            })
            .filter(Boolean)
            .join("")}${s.caption ? `<p class="caption">${escapeHtml(s.caption)}</p>` : ""}</div>`
        case "divider":
          return `<hr class="sep" />`
        default:
          return ""
      }
    })
    .join("\n")
}

/**
 * Full HTML document for Chromium PDF — print-safe, no app chrome.
 * Caller must supply absolute `https` image URLs where inline images are required.
 * Layout matches ProposalDocumentView (single column, fee schedule + figures in body).
 */
export function buildProposalHtmlForPdf(model: ProposalRenderModel): string {
  const bizName = escapeHtml(model.business.trading_name || model.business.legal_name || model.business.name)
  const title = escapeHtml(model.title || "Proposal")
  const c = model.customer
  const customerMetaHtml = c
    ? `<div class="meta-block"><div class="meta-label">Prepared for</div><div class="meta-value">${escapeHtml(
        c.name
      )}</div>${c.email ? `<div class="meta-sub">${escapeHtml(c.email)}</div>` : ""}</div>`
    : `<div class="meta-block meta-block--empty" aria-hidden="true"></div>`

  const logoUrl = model.business.logo_url ? safeAttrUrl(model.business.logo_url) : ""
  const logo = logoUrl ? `<img class="logo" src="${logoUrl}" alt="" />` : ""

  const refLine = model.proposal_number
    ? `<p class="doc-ref">Ref ${escapeHtml(model.proposal_number)}</p>`
    : ""

  const brandBlock = `<div class="doc-brand">${logo ? `<div class="doc-brand-logo">${logo}</div>` : ""}<div class="doc-brand-text"><div class="meta-label">Prepared by</div><div class="biz-name">${bizName}</div></div></div>`
  const titleBlock = `<div class="doc-title-block"><h1 class="doc-title-h1">${title}</h1>${refLine}</div>`

  const { lead, investment, tail } = splitForInvestmentPlacement(model.sections)
  const showPricingInBody = model.pricing.mode !== "none"
  const showInvestmentShell = investment.length > 0 || showPricingInBody

  let investmentSection = ""
  if (showInvestmentShell) {
    const narrative = investment.length > 0 ? `<div class="inv-narrative">${sectionsHtml(investment)}</div>` : ""
    let figuresBlock = ""
    if (showPricingInBody) {
      const builtInIntro =
        investment.length === 0
          ? `<div class="figures-intro"><h2 class="inv-h2">${escapeHtml(
              PROPOSAL_PRICING_SECTION_HEADING
            )}</h2><p class="muted doc-p">${escapeHtml(PROPOSAL_PRICING_SECTION_INTRO)}</p></div>`
          : ""
      const borderClass = investment.length > 0 ? " figures-bordered" : ""
      figuresBlock = `<div class="figures-wrap${borderClass}">${builtInIntro}${pricingHtml(model.pricing, model.currency_code)}</div>`
    }
    investmentSection = `<section class="investment-shell" aria-label="${escapeHtml(
      PROPOSAL_PRICING_SECTION_HEADING
    )}">${narrative}${figuresBlock}</section>`
  }

  const attachBlock =
    model.attachments.length > 0
      ? `<section class="attachments"><h2>Supporting documents</h2><ul>${model.attachments
          .map((a) => `<li><span>${escapeHtml(a.file_name)}</span> <span class="muted">(${escapeHtml(a.mime_type)})</span></li>`)
          .join("")}</ul><p class="muted small">Download links are available in the online proposal.</p></section>`
      : ""

  const bodyMain = `${sectionsHtml(lead)}${investmentSection}${sectionsHtml(tail)}${attachBlock}`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; }
    @page { size: A4; margin: 12mm; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a; font-size: 11pt; line-height: 1.5; margin: 0; padding: 0; }
    .page { padding: 8mm 10mm; max-width: 190mm; margin: 0 auto; }
    .doc-header {
      display: grid;
      grid-template-columns: minmax(0, 0.93fr) minmax(0, 2.07fr) minmax(0, 0.82fr);
      gap: 10px 16px;
      align-items: center;
      margin-bottom: 14px;
      padding-bottom: 12px;
      border-bottom: 1px solid #e2e8f0;
      page-break-inside: avoid;
    }
    .doc-brand { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .doc-brand-logo .logo { display: block; }
    .logo { max-height: 114px; max-width: 320px; object-fit: contain; }
    .biz-name { font-size: 11.5pt; font-weight: 600; color: #0f172a; line-height: 1.28; margin-top: 3px; }
    .doc-title-block { text-align: center; min-width: 0; padding: 0 6px; }
    .doc-title-h1 {
      margin: 0;
      font-size: 16.75pt;
      font-weight: 700;
      line-height: 1.2;
      letter-spacing: -0.02em;
      text-wrap: balance;
    }
    .doc-ref { margin: 5px 0 0; font-size: 8pt; font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; color: #94a3b8; }
    h1 { font-size: 20pt; margin: 0 0 4px; letter-spacing: -0.02em; }
    h2 { font-size: 14pt; margin: 16px 0 8px; letter-spacing: -0.02em; }
    h2.inv-h2 { margin-top: 0; border: none; padding: 0; }
    h3 { font-size: 11pt; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; font-weight: 600; }
    .doc-p { margin: 0 0 10px; font-size: 11pt; color: #334155; }
    .doc-ul { margin: 0 0 12px 20px; padding: 0; }
    .muted { color: #64748b; }
    .small { font-size: 9pt; }
    .meta-block { text-align: right; font-size: 10pt; min-width: 0; }
    .meta-block--empty { visibility: hidden; pointer-events: none; }
    .meta-label { text-transform: uppercase; letter-spacing: 0.06em; font-size: 8pt; color: #64748b; font-weight: 600; }
    .meta-value { font-weight: 600; margin-top: 3px; }
    .meta-sub { color: #475569; }
    .main-doc { max-width: 100%; }
    .investment-shell {
      margin: 16px 0 20px;
      padding: 14px 16px;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
      background: linear-gradient(180deg, #f8fafc 0%, #ffffff 55%);
      page-break-inside: avoid;
    }
    .inv-narrative h1, .inv-narrative h2 { margin-top: 0; }
    .figures-wrap.figures-bordered { margin-top: 14px; padding-top: 14px; border-top: 1px solid #e2e8f0; }
    .figures-intro { margin-bottom: 10px; }
    .pricing-fixed {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 14px 16px;
    }
    .pricing-label { font-size: 9pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
    .pricing-amount { font-size: 18pt; font-weight: 700; margin-top: 6px; }
    .pricing-table-wrap {
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      overflow: hidden;
      background: #fff;
    }
    .pricing-custom {
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 8px 12px;
      background: #fff;
    }
    .cp-spacer { height: 6px; }
    .cp-h {
      margin: 8px 0 5px;
      font-size: 8.5pt;
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #64748b;
    }
    .cp-h:first-child { margin-top: 2px; }
    .cp-rate-group {
      margin: 5px 0 7px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      overflow: hidden;
      background: #f8fafc;
    }
    .cp-rate-group .cp-rate-row {
      display: grid;
      grid-template-columns: 1fr minmax(9.5rem, 38%);
      gap: 5px 14px;
      align-items: start;
      padding: 7px 11px;
      font-size: 10.25pt;
      line-height: 1.42;
      border-bottom: 1px solid #e2e8f0;
    }
    .cp-rate-group .cp-rate-row:last-child { border-bottom: none; }
    .cp-label {
      font-weight: 500;
      color: #334155;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .cp-value {
      font-weight: 600;
      color: #0f172a;
      text-align: right;
      overflow-wrap: anywhere;
      word-break: break-word;
      white-space: normal;
    }
    .cp-ul { margin: 5px 0 6px 18px; padding: 0; }
    .cp-li { margin: 2px 0; color: #334155; font-size: 10.25pt; }
    .cp-p { margin: 5px 0 6px; font-size: 10.25pt; color: #334155; line-height: 1.45; }
    table.lines { width: 100%; border-collapse: collapse; font-size: 10.5pt; }
    table.lines th, table.lines td { border-bottom: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; vertical-align: top; }
    table.lines thead th { background: #f8fafc; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 600; }
    table.lines .td-desc { color: #1e293b; }
    table.lines .num { text-align: right; white-space: nowrap; }
    table.lines .strong { font-weight: 600; color: #0f172a; }
    .fig { margin: 10px 0; }
    .inline-img { max-width: 100%; height: auto; border-radius: 6px; display: block; }
    .gallery { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .fig.g { margin: 0; }
    .caption { font-size: 9pt; color: #64748b; margin-top: 4px; }
    hr.sep { border: none; border-top: 1px solid #e2e8f0; margin: 18px 0; }
    .attachments { margin-top: 22px; page-break-inside: avoid; border-top: 1px solid #e2e8f0; padding-top: 14px; }
    .attachments h2 { margin-top: 0; font-size: 13pt; border: none; padding: 0; }
    .attachments ul { list-style: disc; }
  </style>
</head>
<body>
  <div class="page">
    <header class="doc-header">
      ${brandBlock}
      ${titleBlock}
      ${customerMetaHtml}
    </header>
    <div class="main-doc">
      ${bodyMain}
    </div>
  </div>
</body>
</html>`
}
