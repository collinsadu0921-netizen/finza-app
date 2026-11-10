import type {
  ProposalRenderAttachment,
  ProposalRenderModel,
  ProposalRenderSection,
} from "./renderModel"
import { composeProposalBook, type ProposalBook, type ProposalChapter } from "./composition"
import { getChapterLayout } from "./layout"
import type { ProposalTheme } from "./design"
import { customPricingNotesToHtml } from "./parseCustomPricing"
import { escapeHtml } from "./htmlEscape"
import { GELASIO_400, GELASIO_400_ITALIC, GELASIO_600 } from "./gelasioFontData"

const GELASIO_FONT_CSS = `
@font-face {
  font-family: "Gelasio";
  src: url("data:font/woff2;base64,${GELASIO_400}") format("woff2");
  font-style: normal;
  font-weight: 400;
  font-display: block;
}
@font-face {
  font-family: "Gelasio";
  src: url("data:font/woff2;base64,${GELASIO_600}") format("woff2");
  font-style: normal;
  font-weight: 600;
  font-display: block;
}
@font-face {
  font-family: "Gelasio";
  src: url("data:font/woff2;base64,${GELASIO_400_ITALIC}") format("woff2");
  font-style: italic;
  font-weight: 400;
  font-display: block;
}
`

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

function coverHtml(book: ProposalBook, coverImageDataUri?: string): string {
  const cover = book.cover
  const coverImage = coverImageDataUri || safeAttrUrl(cover.coverImageUrl)
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

  return `<section class="pdf-cover pdf-cover--${book.theme.coverStyle}${
    coverImage ? " pdf-cover--with-image" : ""
  }">
    ${
      coverImage
        ? `<img class="pdf-cover-preload" src="${coverImage}" alt="" aria-hidden="true" onerror="this.style.display='none'" />`
        : ""
    }
    <div class="pdf-cover-art" aria-hidden="true"${
      coverImage ? ` style="background-image:url('${coverImage}')"` : ""
    }>${
      coverImage
        ? `<div class="pdf-cover-image-shade"></div><div class="pdf-cover-image-panel"></div>`
        : ""
    }</div>
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

function imageSizeAttrs(width?: number, height?: number): string {
  if (!width || !height) return ""
  return ` width="${Math.round(width)}" height="${Math.round(height)}"`
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
      if (!src || section.unavailable) {
        return `<figure class="pdf-figure is-missing">${
          section.caption ? `<figcaption>${escapeHtml(section.caption)}</figcaption>` : ""
        }</figure>`
      }
      return `<figure class="pdf-figure"><img src="${src}" alt=""${imageSizeAttrs(
        section.width,
        section.height
      )} onerror="this.style.display='none';this.parentElement.classList.add('is-missing')" />${
        section.caption ? `<figcaption>${escapeHtml(section.caption)}</figcaption>` : ""
      }</figure>`
    }
    case "gallery": {
      const images = section.images
        .map((image) => {
          const src = safeAttrUrl(image.src)
          const unavailable = image.unavailable || !src
          return `<figure class="pdf-figure pdf-gallery-item${unavailable ? " is-missing" : ""}">${
            unavailable
              ? ""
              : `<img src="${src}" alt=""${imageSizeAttrs(
                  image.width,
                  image.height
                )} onerror="this.style.display='none';this.parentElement.classList.add('is-missing')" />`
          }</figure>`
        })
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
        .map((item, index) => {
          const discount = Number(item.discount_amount ?? 0)
          return `<tr data-line-item="${index}">
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

  // Keep short pricing cards intact; allow genuinely long line-item tables to
  // paginate with a repeated table header instead of overflowing a page.
  const keepTogether =
    pricing.mode !== "line_items" ||
    (pricing.mode === "line_items" && pricing.items.length <= 8)
  const longTable = pricing.mode === "line_items" && pricing.items.length > 8

  return `<section class="pdf-pricing pdf-pricing--${theme.id}${
    keepTogether ? " pdf-pricing--keep" : ""
  }${longTable ? " pdf-pricing--long" : ""}">
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

function acceptanceHtml(model: ProposalRenderModel): string {
  const status = String(model.status || "draft").toLowerCase()
  const decisionDate = model.accepted_at || model.rejected_at
  const dateLabel = decisionDate
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(
        new Date(decisionDate)
      )
    : null
  const title =
    status === "accepted" || status === "converted"
      ? "Accepted online"
      : status === "rejected"
        ? "Declined online"
        : status === "sent" || status === "viewed"
          ? "Awaiting client decision"
          : "Draft proposal"
  const body =
    status === "accepted" || status === "converted"
      ? `This proposal was accepted online${dateLabel ? ` on ${dateLabel}` : ""}. The recorded decision confirms the scope, timeline and investment described in this document.`
      : status === "rejected"
        ? `This proposal was declined online${dateLabel ? ` on ${dateLabel}` : ""}.${model.rejected_reason ? ` Client note: ${model.rejected_reason}` : ""}`
        : status === "sent" || status === "viewed"
          ? "The client can accept or decline this proposal through the public proposal link. The decision is recorded electronically; no handwritten signature is captured."
          : "This proposal has not yet been sent to the client."

  return `<section class="pdf-acceptance pdf-acceptance--${escapeHtml(status)}">
    <span class="pdf-eyebrow">Client decision</span>
    <h3>${escapeHtml(title)}</h3>
    <p class="pdf-paragraph">${escapeHtml(body)}</p>
    <p class="pdf-acceptance-note">Online acceptance is an electronic decision record. It is not a qualified electronic signature and this document does not capture a handwritten signature.</p>
  </section>`
}

/** Footer template for the Chromium PDF layer; page numbers are supplied by Chromium. */
export function proposalPdfFooterTemplate(model: ProposalRenderModel): string {
  const business =
    model.business.trading_name || model.business.legal_name || model.business.name || "Proposal"
  const title = model.title || "Proposal"
  return `<div style="width:100%;font-family:Arial,sans-serif;font-size:7px;color:#8a8178;padding:0 12mm;display:flex;justify-content:space-between;gap:12mm;">
    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%;">${escapeHtml(business)} · ${escapeHtml(title)}</span>
    <span style="white-space:nowrap;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>`
}

function chapterHtml(chapter: ProposalChapter, book: ProposalBook, model: ProposalRenderModel): string {
  const body = chapter.blocks.map(sectionHtml).join("\n")
  const pricing = chapter.kind === "pricing" ? pricingHtml(book, model) : ""
  const attachments = attachmentsHtml(chapter.attachments)
  const acceptance = chapter.kind === "acceptance" ? acceptanceHtml(model) : ""
  const layout = getChapterLayout(chapter, chapter.number - 1)
  const classes = [
    "pdf-chapter",
    layout.newPage ? "pdf-chapter--new-page" : "",
    layout.lead ? "pdf-chapter--lead" : "",
    layout.twoColumn ? "pdf-chapter--two-col" : "",
    layout.timeline ? "pdf-chapter--timeline" : "",
    layout.scope ? "pdf-chapter--scope" : "",
    layout.hasImages ? "pdf-chapter--has-images" : "",
    layout.imageText ? "pdf-chapter--image-text" : "",
    layout.major ? "pdf-chapter--major" : "",
    chapter.kind === "acceptance" ? "pdf-chapter--acceptance" : "",
    `pdf-chapter--${book.theme.id}`,
  ]
    .filter(Boolean)
    .join(" ")
  return `<section class="${classes}" id="${escapeHtml(chapter.key)}">
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
  @page { size: A4; margin: 14mm 14mm 18mm; }
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
  .pdf-cover-preload {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }
  .pdf-cover-image-shade {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.28);
  }
  .pdf-cover-image-panel {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 52%;
    background: var(--pdf-cover-bg);
  }
  .pdf-cover--with-image .pdf-cover-art::after {
    content: none;
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
  .pdf-cover-logo { max-height: 16mm; max-width: 46mm; object-fit: contain; background: #fff; padding: 1.5mm; }
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
    padding: 2mm 2mm 4mm;
    margin: 0 0 8mm;
    background: var(--pdf-paper);
    break-before: auto;
    page-break-before: auto;
  }
  .pdf-chapter--new-page {
    break-before: page;
    page-break-before: always;
    margin-top: 0;
    padding-top: 0;
  }
  .pdf-chapter--has-images { break-inside: auto; }
  .pdf-chapter--acceptance { break-inside: avoid; page-break-inside: avoid; }
  .pdf-chapter-head {
    display: flex;
    gap: 6mm;
    align-items: flex-start;
    border-bottom: 1px solid var(--pdf-rule);
    padding-bottom: 4mm;
    margin-bottom: 6mm;
    break-inside: avoid;
    page-break-inside: avoid;
    break-after: avoid;
    page-break-after: avoid;
  }
  .pdf-chapter-number { font-family: var(--pdf-heading-font); font-size: 22pt; line-height: 0.9; color: var(--pdf-accent); opacity: 0.28; min-width: 12mm; }
  .pdf-chapter-head h2 { margin: 0.5mm 0 0; font-family: var(--pdf-heading-font); font-size: 21pt; line-height: 1.08; font-weight: 600; letter-spacing: -0.02em; color: var(--pdf-ink); }
  .pdf-chapter--modern_v1 .pdf-chapter-head h2 { font-weight: 800; }
  .pdf-chapter--premium_v1 .pdf-chapter-head h2 { font-weight: 400; }
  .pdf-chapter-body { max-width: 100%; }
  .pdf-section-heading { font-family: var(--pdf-heading-font); margin: 5mm 0 1.5mm; font-size: 12.5pt; line-height: 1.2; font-weight: 600; color: var(--pdf-ink); break-after: avoid; page-break-after: avoid; }
  .pdf-paragraph { margin: 0 0 3.2mm; font-size: 10.5pt; color: var(--pdf-ink); orphans: 3; widows: 3; }
  .pdf-chapter--lead .pdf-paragraph:first-of-type { font-size: 13pt; line-height: 1.55; color: var(--pdf-ink); }
  .pdf-list { margin: 2mm 0 4mm 5mm; padding: 0; }
  .pdf-list li { margin: 0 0 1.2mm; padding-left: 1mm; break-inside: avoid; }
  .pdf-chapter--two-col .pdf-list { columns: 2; column-gap: 10mm; }
  .pdf-chapter--timeline .pdf-list { list-style: none; margin-left: 0; border-left: 1px solid var(--pdf-rule); padding-left: 4mm; }
  .pdf-chapter--timeline .pdf-list li { position: relative; padding-left: 3mm; }
  .pdf-chapter--timeline .pdf-list li::before { content: ""; position: absolute; left: -5.2mm; top: 1.7mm; width: 1.8mm; height: 1.8mm; border-radius: 50%; background: var(--pdf-accent); }
  .pdf-figure { margin: 4mm 0; page-break-inside: avoid; break-inside: avoid; }
  .pdf-figure img { display: block; max-width: 100%; max-height: 180mm; width: auto; height: auto; object-fit: contain; border-radius: var(--pdf-radius); }
  .pdf-figure figcaption, .pdf-caption { margin-top: 1.5mm; font-size: 8pt; color: var(--pdf-muted); break-before: avoid; page-break-before: avoid; }
  .pdf-figure.is-missing { min-height: 22mm; display: block; padding: 8mm 4mm; text-align: center; border: 1px dashed var(--pdf-rule); border-radius: var(--pdf-radius); background: var(--pdf-paper-alt); }
  .pdf-figure.is-missing::before { content: "Image unavailable"; display: block; font-size: 8pt; color: var(--pdf-muted); }
  .pdf-figure.is-missing figcaption { margin-top: 2mm; }
  .pdf-chapter--image-text .pdf-chapter-body { display: flow-root; }
  .pdf-chapter--image-text .pdf-figure { float: right; width: 44%; margin: 0 0 4mm 8mm; }
  .pdf-chapter--image-text .pdf-figure img { max-height: 105mm; }
  .pdf-gallery { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; margin: 4mm 0; break-inside: avoid; align-items: start; }
  .pdf-gallery-item { margin: 0; }
  .pdf-gallery-item img { width: 100%; height: auto; max-height: 65mm; object-fit: contain; border-radius: var(--pdf-radius); }
  .pdf-divider { border: 0; border-top: 1px solid var(--pdf-rule); margin: 6mm 0; }
  .pdf-pricing { margin: 6mm 0 4mm; padding: 6mm; background: var(--pdf-card); border: 1px solid var(--pdf-rule); border-radius: var(--pdf-radius); break-inside: auto; page-break-inside: auto; }
  .pdf-pricing--keep { break-inside: avoid; page-break-inside: avoid; }
  .pdf-pricing--long { padding: 0; border: 0; background: transparent; }
  .pdf-pricing--long .pdf-pricing-heading { padding: 0 0 2mm; }
  .pdf-pricing--long .pdf-price-table { font-size: 9pt; }
  .pdf-pricing-heading { break-after: avoid; page-break-after: avoid; }
  .pdf-pricing-heading h3 { margin: 1mm 0 4mm; font-family: var(--pdf-heading-font); font-size: 15pt; font-weight: 600; }
  .pdf-price-fixed { display: flex; align-items: baseline; justify-content: space-between; gap: 8mm; border-top: 1px solid var(--pdf-rule); border-bottom: 1px solid var(--pdf-rule); padding: 5mm 0; break-inside: avoid; }
  .pdf-price-fixed span { font-size: 9pt; color: var(--pdf-muted); }
  .pdf-price-fixed strong { font-family: var(--pdf-heading-font); font-size: 22pt; font-weight: 600; }
  .pdf-price-table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  .pdf-price-table thead { display: table-header-group; }
  .pdf-price-table tfoot { display: table-row-group; }
  .pdf-price-table th, .pdf-price-table td { border-bottom: 1px solid var(--pdf-rule); padding: 2.4mm 2mm; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
  .pdf-price-table thead th { font-family: var(--pdf-eyebrow-font); font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: var(--pdf-muted); }
  .pdf-price-table .num { text-align: right; white-space: nowrap; overflow-wrap: normal; }
  .pdf-price-table .strong { font-weight: 600; color: var(--pdf-ink); }
  .pdf-price-table tr { page-break-inside: avoid; break-inside: avoid; }
  .pdf-price-total { break-before: avoid; page-break-before: avoid; }
  .pdf-price-total td { border-top: 1px solid var(--pdf-ink); border-bottom: 0; padding-top: 3.5mm; font-size: 11pt; }
  .pdf-pricing-note { margin: 3.5mm 0 0; font-size: 8pt; color: var(--pdf-muted); break-before: avoid; page-break-before: avoid; }
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
  .pdf-acceptance { margin-top: 7mm; padding: 6mm; border: 1px solid var(--pdf-rule); background: var(--pdf-card); border-radius: var(--pdf-radius); break-inside: avoid; page-break-inside: avoid; }
  .pdf-acceptance h3 { margin: 1mm 0 3mm; font-family: var(--pdf-heading-font); font-size: 18pt; }
  .pdf-acceptance--accepted, .pdf-acceptance--converted { border-color: color-mix(in srgb, var(--pdf-accent) 42%, var(--pdf-rule)); }
  .pdf-acceptance--rejected { border-color: #fecaca; }
  .pdf-acceptance-note { font-size: 8pt; color: var(--pdf-muted); margin: 2mm 0 0; }
  .muted { color: var(--pdf-muted); }
  .small { font-size: 8pt; }
  @media print {
    .pdf-cover { break-after: page; }
    .pdf-chapter--new-page { break-before: page; }
  }
`

function themeCoverImageOpacity(): string {
  // CSS in BASE_CSS uses the variable for real cover images; this value is
  // overridden by the theme-specific rules below.
  return "0.35"
}

export function buildProposalHtmlForPdf(
  model: ProposalRenderModel,
  options?: { coverImageDataUri?: string }
): string {
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
  <style>${GELASIO_FONT_CSS}${themeCss(book.theme)}${BASE_CSS}</style>
</head>
<body class="pdf-document pdf-theme-${escapeHtml(book.templateId)}">
  ${coverHtml(book, options?.coverImageDataUri)}
  ${chapters}
</body>
</html>`
}
