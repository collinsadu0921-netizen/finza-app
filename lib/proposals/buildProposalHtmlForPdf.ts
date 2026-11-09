import type {
  ProposalRenderAttachment,
  ProposalRenderModel,
  ProposalRenderSection,
} from "./renderModel"
import { composeProposalBook, type ProposalBook, type ProposalChapter } from "./composition"
import type { ProposalTheme } from "./design"
import { customPricingNotesToHtml } from "./parseCustomPricing"
import { escapeHtml } from "./htmlEscape"

function formatMoney(amount: number, currency: string | null): string {
  const code = (currency || "GHS").trim().toUpperCase() || "GHS"
  const value = Number.isFinite(Number(amount)) ? Number(amount) : 0
  return `${code} ${new Intl.NumberFormat("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}`
}

/** Allow absolute HTTP(S), protocol-relative and same-origin paths for PDF assets. */
function safeAttrUrl(url: string | null | undefined): string {
  const value = String(url ?? "").trim()
  if (!value) return ""
  if (/^(https?:)?\/\//i.test(value) || value.startsWith("/")) {
    return value.replace(/["']/g, "")
  }
  return ""
}

function lineItemAmount(item: {
  quantity?: number
  unit_price?: number
  line_total?: number
  discount_amount?: number
}): number {
  if (item.line_total != null && Number.isFinite(Number(item.line_total))) {
    return Number(item.line_total)
  }
  const quantity = Number(item.quantity ?? 0)
  const unit = Number(item.unit_price ?? 0)
  const discount = Number(item.discount_amount ?? 0)
  return quantity * unit - discount
}

function pricingSummary(pricing: ProposalRenderModel["pricing"]): {
  total: number | null
  label: string
} {
  if (pricing.mode === "fixed") {
    return { total: Number(pricing.amount) || 0, label: pricing.label?.trim() || "Total investment" }
  }
  if (pricing.mode === "line_items") {
    return {
      total: pricing.items.reduce((sum, item) => sum + lineItemAmount(item), 0),
      label: "Total investment",
    }
  }
  return { total: null, label: "Investment" }
}

function coverMetaRow(label: string, value: string | null | undefined): string {
  if (!value) return ""
  return `<div class="pdf-cover-meta-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
}

function coverHtml(book: ProposalBook): string {
  const cover = book.cover
  const coverImage = safeAttrUrl(cover.coverImageUrl)
  const logo = safeAttrUrl(cover.businessLogoUrl)
  const dateLabel = cover.createdAt
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(
        new Date(cover.createdAt)
      )
    : null
  const expiresLabel = cover.expiresAt
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(
        new Date(cover.expiresAt)
      )
    : null

  return `<section class="pdf-cover pdf-cover--${book.theme.coverStyle}"${
    coverImage ? ` style="--pdf-cover-image:url('${coverImage}')"` : ""
  }>
    <div class="pdf-cover-art" aria-hidden="true"></div>
    <div class="pdf-cover-inner">
      <div class="pdf-cover-brand">
        ${logo ? `<img class="pdf-cover-logo" src="${logo}" alt="" />` : ""}
        <div class="pdf-cover-business">${escapeHtml(cover.businessName)}</div>
      </div>
      <div class="pdf-cover-copy">
        <p class="pdf-eyebrow">Proposal${cover.proposalNumber ? ` · ${escapeHtml(cover.proposalNumber)}` : ""}</p>
        <h1>${escapeHtml(cover.title)}</h1>
        ${
          cover.customerName
            ? `<div class="pdf-cover-client"><span>Prepared for</span><strong>${escapeHtml(
                cover.customerName
              )}</strong>${cover.customerEmail ? `<em>${escapeHtml(cover.customerEmail)}</em>` : ""}</div>`
            : ""
        }
      </div>
      <div class="pdf-cover-meta">
        ${coverMetaRow("Issued", dateLabel)}
        ${coverMetaRow("Valid until", expiresLabel)}
        ${coverMetaRow("Prepared by", cover.businessTradingName || cover.businessLegalName || cover.businessName)}
      </div>
    </div>
  </section>`
}

function sectionHtml(section: ProposalRenderSection): string {
  if (section.hidden) return ""
  switch (section.type) {
    case "heading": {
      const level = Math.min(6, Math.max(2, section.level))
      return `<h${level} class="pdf-section-heading">${escapeHtml(section.text)}</h${level}>`
    }
    case "paragraph":
      return `<p class="pdf-paragraph">${escapeHtml(section.text).replace(/\n/g, "<br/>")}</p>`
    case "bullet_list":
      return `<ul class="pdf-list">${section.items
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join("")}</ul>`
    case "image": {
      const src = safeAttrUrl(section.src)
      if (!src) return ""
      return `<figure class="pdf-figure"><img src="${src}" alt="" />${
        section.caption ? `<figcaption>${escapeHtml(section.caption)}</figcaption>` : ""
      }</figure>`
    }
    case "gallery": {
      const images = section.images
        .map((image) => safeAttrUrl(image.src))
        .filter(Boolean)
        .map((src) => `<figure class="pdf-figure pdf-gallery-item"><img src="${src}" alt="" /></figure>`)
        .join("")
      if (!images) return ""
      return `<div class="pdf-gallery">${images}</div>${
        section.caption ? `<p class="pdf-caption">${escapeHtml(section.caption)}</p>` : ""
      }`
    }
    case "divider":
      return `<hr class="pdf-divider" />`
    default:
      return ""
  }
}

function pricingHtml(book: ProposalBook, model: ProposalRenderModel): string {
  const pricing = model.pricing
  const theme = book.theme
  if (pricing.mode === "none") return ""

  const summary = pricingSummary(pricing)
  const currency = model.currency_code
  let body = ""

  if (pricing.mode === "fixed") {
    body = `<div class="pdf-price-fixed">
      <span>${escapeHtml(pricing.label?.trim() || "Total investment")}</span>
      <strong>${formatMoney(Number(pricing.amount) || 0, currency)}</strong>
    </div>`
  } else if (pricing.mode === "line_items") {
    const showDiscount = pricing.items.some((item) => Number(item.discount_amount ?? 0) > 0)
    body = `<table class="pdf-price-table">
      <thead><tr><th>Description</th><th class="num">Qty</th>${
        showDiscount ? `<th class="num">Discount</th>` : ""
      }<th class="num">Amount</th></tr></thead>
      <tbody>${pricing.items
        .map((item) => {
          const discount = Number(item.discount_amount ?? 0)
          return `<tr>
            <td class="desc">${escapeHtml(item.description)}</td>
            <td class="num">${item.quantity != null ? escapeHtml(String(item.quantity)) : "—"}</td>
            ${showDiscount ? `<td class="num">${discount > 0 ? formatMoney(discount, currency) : "—"}</td>` : ""}
            <td class="num strong">${formatMoney(lineItemAmount(item), currency)}</td>
          </tr>`
        })
        .join("")}</tbody>
      <tfoot><tr class="pdf-price-total"><td colspan="${showDiscount ? 3 : 2}">${
        summary.label
      }</td><td class="num strong">${formatMoney(summary.total ?? 0, currency)}</td></tr></tfoot>
    </table>`
  } else {
    body = `<div class="pdf-custom-pricing">${customPricingNotesToHtml(pricing.notes)}</div>`
  }

  return `<section class="pdf-pricing pdf-pricing--${theme.id}">
    <div class="pdf-pricing-heading"><span class="pdf-eyebrow">Investment</span><h3>${escapeHtml(
      summary.label
    )}</h3></div>
    ${body}
    <p class="pdf-pricing-note">Pricing is a proposal summary. Applicable taxes are applied by Finza when the proposal is converted to an estimate or invoice.</p>
  </section>`
}

function attachmentsHtml(attachments: ProposalRenderAttachment[]): string {
  if (attachments.length === 0) return ""
  return `<section class="pdf-attachments"><h3>Supporting documents</h3><ul>${attachments
    .map((attachment) => {
      const href = safeAttrUrl(attachment.url)
      return `<li><span>${escapeHtml(attachment.file_name)}</span> <span class="muted">(${escapeHtml(
        attachment.mime_type
      )})</span>${href ? `<br/><a href="${href}">${escapeHtml(href)}</a>` : ""}</li>`
    })
    .join("")}</ul></section>`
}

function acceptanceHtml(): string {
  return `<section class="pdf-acceptance">
    <span class="pdf-eyebrow">Client decision</span>
    <h3>Acceptance</h3>
    <p class="pdf-paragraph">By accepting this proposal, the client confirms the scope, timeline and investment described in this document.</p>
    <div class="pdf-signature-grid">
      <div><span>Name</span><i></i></div>
      <div><span>Signature</span><i></i></div>
      <div><span>Date</span><i></i></div>
    </div>
    <p class="pdf-acceptance-note">Online acceptance through the proposal link records the client's decision. This PDF signature block is optional and is not a qualified electronic signature.</p>
  </section>`
}

function chapterHtml(chapter: ProposalChapter, book: ProposalBook, model: ProposalRenderModel): string {
  const body = chapter.blocks.map(sectionHtml).join("\n")
  const pricing = chapter.kind === "pricing" ? pricingHtml(book, model) : ""
  const attachments = attachmentsHtml(chapter.attachments)
  const acceptance = chapter.kind === "acceptance" ? acceptanceHtml() : ""
  return `<section class="pdf-chapter" id="${escapeHtml(chapter.key)}">
    <header class="pdf-chapter-head">
      <span class="pdf-chapter-number">${String(chapter.number).padStart(2, "0")}</span>
      <div>
        <span class="pdf-eyebrow">${escapeHtml(chapter.eyebrow)}</span>
        <h2>${escapeHtml(chapter.title)}</h2>
      </div>
    </header>
    <div class="pdf-chapter-body">
      ${body}
      ${pricing}
      ${attachments}
      ${acceptance}
    </div>
  </section>`
}

function themeCss(theme: ProposalTheme): string {
  return `
    :root {
      --pdf-accent: ${theme.accent};
      --pdf-accent-soft: ${theme.accentSoft};
      --pdf-accent-contrast: ${theme.accentContrast};
      --pdf-paper: ${theme.paper};
      --pdf-paper-alt: ${theme.paperAlt};
      --pdf-ink: ${theme.ink};
      --pdf-muted: ${theme.muted};
      --pdf-rule: ${theme.rule};
      --pdf-card: ${theme.card};
      --pdf-cover-bg: ${theme.coverBg};
      --pdf-cover-ink: ${theme.coverInk};
      --pdf-cover-muted: ${theme.coverMuted};
      --pdf-heading-font: ${theme.headingFont};
      --pdf-body-font: ${theme.bodyFont};
      --pdf-eyebrow-font: ${theme.eyebrowFont};
      --pdf-radius: ${theme.radius};
    }
  `
}

const BASE_CSS = `
  * { box-sizing: border-box; }
  @page { size: A4; margin: 14mm 14mm 16mm; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: var(--pdf-body-font);
    color: var(--pdf-ink);
    background: var(--pdf-paper);
    font-size: 10.5pt;
    line-height: 1.58;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .pdf-cover {
    position: relative;
    min-height: 258mm;
    padding: 18mm;
    margin: 0 0 14mm;
    background: var(--pdf-cover-bg);
    color: var(--pdf-cover-ink);
    overflow: hidden;
    page-break-after: always;
    break-after: page;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .pdf-cover-art {
    position: absolute;
    inset: 0;
    background-image: var(--pdf-cover-image, none);
    background-size: cover;
    background-position: center;
    opacity: ${themeCoverImageOpacity()};
  }
  .pdf-cover--minimal .pdf-cover-art {
    opacity: 0;
    border: 1px solid var(--pdf-rule);
    inset: 12mm;
  }
  .pdf-cover--modern .pdf-cover-art::after,
  .pdf-cover--premium .pdf-cover-art::after {
    content: "";
    position: absolute;
    inset: 0;
    background:
      linear-gradient(90deg, var(--pdf-cover-bg) 0%, var(--pdf-cover-bg) 58%, rgba(0,0,0,0.28) 82%, rgba(0,0,0,0.58) 100%),
      linear-gradient(180deg, rgba(0,0,0,0.12), rgba(0,0,0,0.52));
  }
  .pdf-cover--minimal .pdf-cover-art::after { content: none; }
  .pdf-cover--modern .pdf-cover-art {
    background-image: var(--pdf-cover-image, none), radial-gradient(circle at 80% 20%, var(--pdf-accent) 0, transparent 34%), linear-gradient(135deg, #0b1220, #111c33);
    opacity: 1;
  }
  .pdf-cover--premium .pdf-cover-art {
    background-image: var(--pdf-cover-image, none), radial-gradient(circle at 85% 18%, rgba(166,119,63,0.5) 0, transparent 30%), linear-gradient(160deg, #1c1917, #292524);
    opacity: 1;
  }
  .pdf-cover--premium .pdf-cover-art::before {
    content: "";
    position: absolute;
    left: 14mm;
    top: 36mm;
    bottom: 36mm;
    width: 1px;
    background: rgba(250,247,242,0.24);
  }
  .pdf-cover--classic .pdf-cover-art { opacity: 0; }
  .pdf-cover-inner { position: relative; z-index: 1; display: flex; flex-direction: column; min-height: 222mm; }
  .pdf-cover-brand { display: flex; align-items: center; gap: 10mm; }
  .pdf-cover-logo { max-height: 22mm; max-width: 58mm; object-fit: contain; background: #fff; padding: 2mm; }
  .pdf-cover-business { font-size: 11pt; font-weight: 600; letter-spacing: 0.04em; }
  .pdf-cover-copy { margin-top: auto; padding: 18mm 0; max-width: 150mm; }
  .pdf-eyebrow { font-family: var(--pdf-eyebrow-font); font-size: 7.5pt; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: var(--pdf-accent); }
  .pdf-cover .pdf-eyebrow { color: var(--pdf-accent-contrast); opacity: 0.82; }
  .pdf-cover h1 { margin: 5mm 0 8mm; font-family: var(--pdf-heading-font); font-size: 40pt; line-height: 1.02; font-weight: 600; letter-spacing: -0.035em; }
  .pdf-cover--modern h1 { font-size: 43pt; font-weight: 800; text-transform: none; }
  .pdf-cover--premium h1 { font-size: 42pt; font-weight: 400; }
  .pdf-cover-client { display: flex; flex-direction: column; gap: 1.5mm; border-left: 2px solid var(--pdf-accent); padding-left: 6mm; }
  .pdf-cover-client span, .pdf-cover-meta-row span { font-family: var(--pdf-eyebrow-font); font-size: 7pt; text-transform: uppercase; letter-spacing: 0.14em; color: var(--pdf-cover-muted); }
  .pdf-cover-client strong { font-size: 14pt; font-weight: 600; }
  .pdf-cover-client em { font-style: normal; font-size: 9pt; color: var(--pdf-cover-muted); }
  .pdf-cover-meta { display: flex; flex-wrap: wrap; gap: 6mm 16mm; border-top: 1px solid rgba(255,255,255,0.18); padding-top: 6mm; }
  .pdf-cover--minimal .pdf-cover-meta { border-color: var(--pdf-rule); }
  .pdf-cover-meta-row { display: flex; flex-direction: column; gap: 1mm; }
  .pdf-cover-meta-row strong { font-size: 9pt; font-weight: 600; }
  .pdf-chapter {
    padding: 4mm 2mm 10mm;
    background: var(--pdf-paper);
    page-break-before: always;
    break-before: page;
  }
  .pdf-chapter-head { display: flex; gap: 8mm; align-items: flex-start; border-bottom: 1px solid var(--pdf-rule); padding-bottom: 6mm; margin-bottom: 8mm; page-break-after: avoid; }
  .pdf-chapter-number { font-family: var(--pdf-heading-font); font-size: 34pt; line-height: 0.9; color: var(--pdf-accent); opacity: 0.35; min-width: 18mm; }
  .pdf-chapter-head h2 { margin: 1mm 0 0; font-family: var(--pdf-heading-font); font-size: 25pt; line-height: 1.08; font-weight: 600; letter-spacing: -0.025em; color: var(--pdf-ink); }
  .pdf-chapter--modern .pdf-chapter-head h2 { text-transform: none; font-weight: 800; }
  .pdf-chapter-body { max-width: 100%; }
  .pdf-section-heading { font-family: var(--pdf-heading-font); margin: 7mm 0 2mm; font-size: 14pt; line-height: 1.2; font-weight: 600; color: var(--pdf-ink); page-break-after: avoid; }
  .pdf-paragraph { margin: 0 0 3.5mm; font-size: 10.5pt; color: var(--pdf-ink); }
  .pdf-list { margin: 2mm 0 4mm 5mm; padding: 0; }
  .pdf-list li { margin: 0 0 1.4mm; padding-left: 1mm; }
  .pdf-figure { margin: 5mm 0; page-break-inside: avoid; }
  .pdf-figure img { max-width: 100%; height: auto; border-radius: var(--pdf-radius); }
  .pdf-figure figcaption, .pdf-caption { margin-top: 1.5mm; font-size: 8pt; color: var(--pdf-muted); }
  .pdf-gallery { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; margin: 4mm 0; }
  .pdf-gallery-item { margin: 0; }
  .pdf-gallery-item img { width: 100%; height: 55mm; object-fit: cover; border-radius: var(--pdf-radius); }
  .pdf-divider { border: 0; border-top: 1px solid var(--pdf-rule); margin: 7mm 0; }
  .pdf-pricing { margin: 8mm 0 4mm; padding: 7mm; background: var(--pdf-card); border: 1px solid var(--pdf-rule); border-radius: var(--pdf-radius); page-break-inside: auto; }
  .pdf-pricing-heading h3 { margin: 1mm 0 5mm; font-family: var(--pdf-heading-font); font-size: 17pt; font-weight: 600; }
  .pdf-price-fixed { display: flex; align-items: baseline; justify-content: space-between; gap: 8mm; border-top: 1px solid var(--pdf-rule); border-bottom: 1px solid var(--pdf-rule); padding: 6mm 0; }
  .pdf-price-fixed span { font-size: 9pt; color: var(--pdf-muted); }
  .pdf-price-fixed strong { font-family: var(--pdf-heading-font); font-size: 24pt; font-weight: 600; }
  .pdf-price-table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  .pdf-price-table th, .pdf-price-table td { border-bottom: 1px solid var(--pdf-rule); padding: 2.6mm 2mm; text-align: left; vertical-align: top; }
  .pdf-price-table thead th { font-family: var(--pdf-eyebrow-font); font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: var(--pdf-muted); }
  .pdf-price-table .num { text-align: right; white-space: nowrap; }
  .pdf-price-table .strong { font-weight: 600; color: var(--pdf-ink); }
  .pdf-price-table tr { page-break-inside: avoid; break-inside: avoid; }
  .pdf-price-total td { border-top: 1px solid var(--pdf-ink); border-bottom: 0; padding-top: 4mm; font-size: 11pt; }
  .pdf-pricing-note { margin: 4mm 0 0; font-size: 8pt; color: var(--pdf-muted); }
  .pdf-custom-pricing { border: 1px solid var(--pdf-rule); border-radius: var(--pdf-radius); padding: 4mm; }
  .pdf-custom-pricing .cp-rate-group { border: 1px solid var(--pdf-rule); border-radius: var(--pdf-radius); overflow: hidden; margin: 2mm 0; }
  .pdf-custom-pricing .cp-rate-row { display: grid; grid-template-columns: 1fr minmax(32mm, 36%); gap: 4mm; padding: 2.2mm 3mm; border-bottom: 1px solid var(--pdf-rule); font-size: 9.5pt; }
  .pdf-custom-pricing .cp-rate-row:last-child { border-bottom: 0; }
  .pdf-custom-pricing .cp-label { color: var(--pdf-ink); }
  .pdf-custom-pricing .cp-value { text-align: right; font-weight: 600; }
  .pdf-custom-pricing .cp-h { margin: 3mm 0 1.5mm; font-family: var(--pdf-eyebrow-font); font-size: 7.5pt; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--pdf-muted); }
  .pdf-custom-pricing .cp-p, .pdf-custom-pricing .cp-li { font-size: 9.5pt; color: var(--pdf-ink); }
  .pdf-custom-pricing .cp-ul { margin: 2mm 0 2mm 4mm; padding: 0; }
  .pdf-custom-pricing .cp-spacer { height: 4mm; }
  .pdf-attachments { margin-top: 7mm; padding-top: 5mm; border-top: 1px solid var(--pdf-rule); page-break-inside: avoid; }
  .pdf-attachments h3 { margin: 0 0 3mm; font-family: var(--pdf-heading-font); font-size: 13pt; }
  .pdf-attachments ul { margin: 0 0 0 4mm; padding: 0; }
  .pdf-attachments li { margin-bottom: 2mm; font-size: 9pt; }
  .pdf-attachments a { color: var(--pdf-accent); word-break: break-all; }
  .pdf-acceptance { margin-top: 9mm; padding: 7mm; border: 1px solid var(--pdf-rule); background: var(--pdf-card); border-radius: var(--pdf-radius); page-break-inside: avoid; }
  .pdf-acceptance h3 { margin: 1mm 0 4mm; font-family: var(--pdf-heading-font); font-size: 20pt; }
  .pdf-signature-grid { display: grid; grid-template-columns: 1.3fr 1.3fr 0.7fr; gap: 8mm; margin: 12mm 0 6mm; }
  .pdf-signature-grid span { font-family: var(--pdf-eyebrow-font); font-size: 7pt; text-transform: uppercase; letter-spacing: 0.12em; color: var(--pdf-muted); }
  .pdf-signature-grid i { display: block; height: 10mm; border-bottom: 1px solid var(--pdf-ink); }
  .pdf-acceptance-note { font-size: 8pt; color: var(--pdf-muted); margin: 0; }
  .muted { color: var(--pdf-muted); }
  .small { font-size: 8pt; }
  @media print {
    .pdf-cover { break-after: page; }
    .pdf-chapter { break-before: page; }
  }
`

function themeCoverImageOpacity(): string {
  // CSS in BASE_CSS uses the variable for real cover images; this value is
  // overridden by the theme-specific rules below.
  return "0.35"
}

export function buildProposalHtmlForPdf(model: ProposalRenderModel): string {
  const book = composeProposalBook(model)
  const title = escapeHtml(model.title || "Proposal")
  const chapters = book.chapters
    .map((chapter) => chapterHtml(chapter, book, model))
    .join("\n")

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>${themeCss(book.theme)}${BASE_CSS}</style>
</head>
<body class="pdf-document pdf-theme-${escapeHtml(book.templateId)}">
  ${coverHtml(book)}
  ${chapters}
</body>
</html>`
}
