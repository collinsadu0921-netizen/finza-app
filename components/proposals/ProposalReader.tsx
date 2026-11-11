"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type TouchEvent,
} from "react"
import BusinessLogoDisplay from "@/components/BusinessLogoDisplay"
import {
  composeProposalBook,
  type ProposalBook,
} from "@/lib/proposals/composition"
import { proposalThemeCssVariables } from "@/lib/proposals/design"
import { proposalCoverCssVariables } from "@/lib/proposals/coverStyle"
import { getChapterLayout } from "@/lib/proposals/layout"
import {
  buildReaderSheets,
  chapterReaderPageNumber,
  chapterStartSheetIndex,
  type ReaderChapterSegment,
  type ReaderSheet,
} from "@/lib/proposals/readerLayout"
import { chunkCustomPricingForDisplay, parseCustomPricingNotes } from "@/lib/proposals/parseCustomPricing"
import type { ProposalRenderModel, ProposalRenderSection } from "@/lib/proposals/renderModel"

type ReaderPage =
  | { kind: "cover"; key: "cover" }
  | { kind: "sheet"; key: string; sheet: ReaderSheet }

type ReaderSpread = { left: number | null; right: number | null }

function asDateLabel(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(date)
}

function formatProposalMoney(amount: number, currency: string | null | undefined): string {
  const code = (currency || "GHS").trim().toUpperCase() || "GHS"
  const value = Number.isFinite(Number(amount)) ? Number(amount) : 0
  return `${code} ${new Intl.NumberFormat("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}`
}

function lineItemAmount(item: {
  quantity?: number
  unit_price?: number
  line_total?: number
  discount_amount?: number
}): number {
  if (item.line_total != null && Number.isFinite(Number(item.line_total))) return Number(item.line_total)
  return Number(item.quantity ?? 0) * Number(item.unit_price ?? 0) - Number(item.discount_amount ?? 0)
}

function BrandMark({
  logoUrl,
  businessName,
}: {
  logoUrl: string | null | undefined
  businessName: string
}) {
  return (
    <BusinessLogoDisplay
      logoUrl={logoUrl}
      businessName={businessName}
      variant="hero"
      rounded="lg"
      brandingResolved
      className="proposal-brand-mark"
    />
  )
}

type PricingLineItem = Extract<ProposalRenderModel["pricing"], { mode: "line_items" }>["items"][number]

function CustomPricingView({ notes }: { notes: string }) {
  const chunks = useMemo(() => chunkCustomPricingForDisplay(parseCustomPricingNotes(notes)), [notes])
  return (
    <div className="proposal-custom-pricing">
      {chunks.map((chunk, index) => {
        if (chunk.kind === "rate_group") {
          return (
            <div key={`rate-${index}`} className="proposal-rate-group">
              {chunk.rows.map((row, rowIndex) => (
                <div key={`row-${rowIndex}`} className="proposal-rate-row">
                  <span className="proposal-rate-label">{row.label}</span>
                  <span className="proposal-rate-value">{row.value}</span>
                </div>
              ))}
            </div>
          )
        }
        if (chunk.kind === "bullet_group") {
          return (
            <ul key={`bullets-${index}`} className="proposal-bullet-list">
              {chunk.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ul>
          )
        }
        const block = chunk.block
        if (block.type === "heading") return <p key={`h-${index}`} className="proposal-rate-heading">{block.text}</p>
        if (block.type === "paragraph") return <p key={`p-${index}`} className="proposal-body-text">{block.text}</p>
        if (block.type === "spacer") return <div key={`sp-${index}`} className="proposal-spacer" aria-hidden />
        return null
      })}
    </div>
  )
}

function PricingView({
  model,
  items,
  showTotal = true,
}: {
  model: ProposalRenderModel
  items?: PricingLineItem[]
  showTotal?: boolean
}) {
  const pricing = model.pricing
  if (pricing.mode === "none") return null
  const currency = model.currency_code

  if (pricing.mode === "fixed") {
    return (
      <div className="proposal-pricing proposal-pricing-fixed">
        <p className="proposal-eyebrow">Investment</p>
        <div className="proposal-fixed-row">
          <span>{pricing.label?.trim() || "Total investment"}</span>
          <strong>{formatProposalMoney(Number(pricing.amount) || 0, currency)}</strong>
        </div>
        <PricingNote />
      </div>
    )
  }

  if (pricing.mode === "line_items") {
    const displayItems = items ?? pricing.items
    const showDiscount = displayItems.some((item) => Number(item.discount_amount ?? 0) > 0)
    const total = pricing.items.reduce((sum, item) => sum + lineItemAmount(item), 0)
    return (
      <div className="proposal-pricing">
        <p className="proposal-eyebrow">Investment</p>
        <div className="proposal-price-table-wrap">
          <table className="proposal-price-table">
            <thead>
              <tr>
                <th>Description</th>
                <th className="num qty">Qty</th>
                {showDiscount ? <th className="num discount">Discount</th> : null}
                <th className="num amount">Amount</th>
              </tr>
            </thead>
            <tbody>
              {displayItems.map((item, index) => {
                const discount = Number(item.discount_amount ?? 0)
                return (
                  <tr key={`${item.description}-${index}`}>
                    <td>{item.description}</td>
                    <td className="num qty">{item.quantity != null ? item.quantity : "—"}</td>
                    {showDiscount ? <td className="num discount">{discount > 0 ? formatProposalMoney(discount, currency) : "—"}</td> : null}
                    <td className="num strong amount">{formatProposalMoney(lineItemAmount(item), currency)}</td>
                  </tr>
                )
              })}
            </tbody>
            {showTotal ? (
              <tfoot>
                <tr>
                  <td colSpan={showDiscount ? 3 : 2}>Total investment</td>
                  <td className="num strong">{formatProposalMoney(total, currency)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
        {showTotal ? <PricingNote /> : null}
      </div>
    )
  }

  return (
    <div className="proposal-pricing">
      <p className="proposal-eyebrow">Investment</p>
      <CustomPricingView notes={pricing.notes ?? ""} />
      <PricingNote />
    </div>
  )
}

function PricingNote() {
  return (
    <p className="proposal-pricing-note">
      Pricing is a proposal summary. Applicable taxes are applied by Finza when the proposal is converted to an estimate or invoice.
    </p>
  )
}

function ProposalImage({
  src,
  alt,
  width,
  height,
  fixedRatio,
  className,
  unavailable,
}: {
  src: string
  alt: string
  width?: number
  height?: number
  fixedRatio?: string
  className?: string
  unavailable?: boolean
}) {
  const [failed, setFailed] = useState(false)
  const ratio = fixedRatio ?? (width && height ? `${width} / ${height}` : "4 / 3")
  const isUnavailable = unavailable || failed || !src
  return (
    <div
      className={`proposal-image-frame ${className ?? ""}`.trim()}
      style={{ aspectRatio: ratio }}
    >
      {isUnavailable ? (
        <div className="proposal-image-fallback" role="img" aria-label={alt || "Image unavailable"}>
          Image unavailable
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="eager"
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  )
}

function BlockView({ block }: { block: ProposalRenderSection }) {
  switch (block.type) {
    case "heading": {
      const Tag = (block.level <= 3 ? "h3" : "h4") as "h3" | "h4"
      return <Tag className="proposal-section-heading">{block.text}</Tag>
    }
    case "paragraph":
      return <p className="proposal-body-text">{block.text}</p>
    case "bullet_list":
      return (
        <ul className="proposal-bullet-list">
          {block.items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      )
    case "image":
      return (
        <figure className="proposal-figure">
          <ProposalImage
            src={block.src}
            alt={block.caption || "Proposal image"}
            width={block.width}
            height={block.height}
            unavailable={block.unavailable}
            className="proposal-image-frame--full"
          />
          {block.caption ? <figcaption>{block.caption}</figcaption> : null}
        </figure>
      )
    case "gallery":
      return (
        <div className="proposal-gallery-wrap">
          <div className="proposal-gallery">
            {block.images.map((image) => (
              <ProposalImage
                key={image.assetId}
                src={image.src}
                alt=""
                unavailable={image.unavailable}
                fixedRatio="4 / 3"
                className="proposal-image-frame--gallery"
              />
            ))}
          </div>
          {block.caption ? <p className="proposal-caption">{block.caption}</p> : null}
        </div>
      )
    case "divider":
      return <hr className="proposal-divider" />
    default:
      return null
  }
}

function CoverPage({ book }: { book: ProposalBook }) {
  const cover = book.cover
  const issued = asDateLabel(cover.createdAt)
  const expires = asDateLabel(cover.expiresAt)
  return (
    <article
      className={`proposal-page proposal-cover${cover.style.isCustom ? " proposal-cover--custom" : ""}${
        cover.style.scrim ? " proposal-cover--scrim" : ""
      }`}
    >
      <div className="proposal-cover-media" aria-hidden>
        {cover.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover.coverImageUrl}
            alt=""
            style={{ objectPosition: cover.style.imagePosition }}
            onError={(event) => {
              event.currentTarget.style.display = "none"
            }}
          />
        ) : (
          <div className={`proposal-cover-pattern pattern-${book.theme.coverPattern}`} />
        )}
        <div className="proposal-cover-shade" />
      </div>
      <div className="proposal-cover-inner">
        <div className="proposal-cover-brand">
          <BrandMark logoUrl={cover.businessLogoUrl} businessName={cover.businessName} />
          <span>{cover.businessName}</span>
        </div>
        <div className="proposal-cover-copy">
          <p className="proposal-eyebrow">
            Proposal{cover.proposalNumber ? ` · ${cover.proposalNumber}` : ""}
          </p>
          <h1>{cover.title}</h1>
          {cover.customerName ? (
            <div className="proposal-cover-client">
              <span>Prepared for</span>
              <strong>{cover.customerName}</strong>
              {cover.customerEmail ? <em>{cover.customerEmail}</em> : null}
            </div>
          ) : null}
        </div>
        <div className="proposal-cover-meta">
          {issued ? <div><span>Issued</span><strong>{issued}</strong></div> : null}
          {expires ? <div><span>Valid until</span><strong>{expires}</strong></div> : null}
          <div><span>Prepared by</span><strong>{cover.businessTradingName || cover.businessLegalName || cover.businessName}</strong></div>
        </div>
      </div>
    </article>
  )
}

function ChapterSection({
  segment,
  sheet,
  model,
  acceptanceSlot,
}: {
  segment: ReaderChapterSegment
  sheet: ReaderSheet
  model: ProposalRenderModel
  acceptanceSlot?: ReactNode
}) {
  const { chapter } = segment
  const layout = getChapterLayout(chapter, segment.chapterIndex)
  const chapterClass = [
    "proposal-chapter",
    layout.lead ? "proposal-chapter--lead" : "",
    layout.twoColumn ? "proposal-chapter--two-col" : "",
    layout.timeline ? "proposal-chapter--timeline" : "",
    layout.scope ? "proposal-chapter--scope" : "",
    layout.hasImages ? "proposal-chapter--has-images" : "",
    layout.imageText ? "proposal-chapter--image-text" : "",
    layout.major ? "proposal-chapter--major" : "",
    segment.continuation ? "proposal-chapter--continued" : "",
    sheet.segments.length > 1 ? "proposal-chapter--shared" : "",
  ]
    .filter(Boolean)
    .join(" ")
  const status = String(model.status || "draft").toLowerCase()
  const accepted = status === "accepted" || status === "converted"
  const rejected = status === "rejected"
  const decisionDate = asDateLabel(accepted ? model.accepted_at : rejected ? model.rejected_at : null)

  return (
    <section className={chapterClass} id={`proposal-chapter-${chapter.key}-${segment.chunkIndex}`}>
      <header className="proposal-chapter-head">
        <span className="proposal-chapter-number">{String(chapter.number).padStart(2, "0")}</span>
        <div>
          <p className="proposal-eyebrow">{segment.continuation ? "Continued" : chapter.eyebrow}</p>
          <h2>{chapter.title}</h2>
        </div>
      </header>
      <div className="proposal-chapter-body">
        {segment.blocks.map((block, index) => (
          <BlockView key={`${chapter.key}-${segment.chunkIndex}-${block.type}-${index}`} block={block} />
        ))}
        {chapter.kind === "pricing" ? (
          <PricingView
            model={model}
            items={segment.pricingItems}
            showTotal={segment.pricingShowTotal ?? true}
          />
        ) : null}
        {segment.isLastChunk && chapter.attachments.length > 0 ? (
          <section className="proposal-attachments">
            <h3>Supporting documents</h3>
            <ul>
              {chapter.attachments.map((attachment) => (
                <li key={attachment.id}>
                  <a href={attachment.url} target="_blank" rel="noreferrer">
                    {attachment.file_name}
                  </a>
                  <span>{attachment.mime_type}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {segment.isLastChunk && chapter.kind === "acceptance" ? (
          <section
            className={`proposal-acceptance${
              acceptanceSlot ? "" : " proposal-acceptance--status-only"
            }`}
          >
            {acceptanceSlot ? <div className="proposal-acceptance-slot">{acceptanceSlot}</div> : null}
            <div className={`proposal-acceptance-status ${accepted ? "is-accepted" : rejected ? "is-rejected" : ""}`}>
              <p className="proposal-acceptance-status-title">
                {accepted ? "Accepted online" : rejected ? "Declined online" : status === "sent" || status === "viewed" ? "Awaiting client decision" : "Draft proposal"}
              </p>
              <p>
                {accepted
                  ? `This proposal was accepted online${decisionDate ? ` on ${decisionDate}` : ""}.`
                  : rejected
                    ? `This proposal was declined online${decisionDate ? ` on ${decisionDate}` : ""}.${model.rejected_reason ? ` Client note: ${model.rejected_reason}` : ""}`
                    : status === "sent" || status === "viewed"
                      ? "The client can accept or decline this proposal through the public proposal link. The decision is recorded electronically; no handwritten signature is captured."
                      : "This proposal has not yet been sent to the client."}
              </p>
            </div>
            <p className="proposal-acceptance-note">
              Online acceptance is an electronic decision record. It is not a qualified electronic signature and this document does not capture a handwritten signature.
            </p>
          </section>
        ) : null}
      </div>
    </section>
  )
}

function ReaderSheetPage({
  sheet,
  book,
  model,
  pageNumber,
  acceptanceSlot,
}: {
  sheet: ReaderSheet
  book: ProposalBook
  model: ProposalRenderModel
  pageNumber: number
  acceptanceSlot?: ReactNode
}) {
  return (
    <article
      className={`proposal-page proposal-sheet${
        sheet.segments.length > 1 ? " proposal-sheet--multi" : ""
      }`}
      id={`proposal-page-${pageNumber}`}
    >
      <div className="proposal-sheet-chapters">
        {sheet.segments.map((segment) => (
          <ChapterSection
            key={segment.key}
            segment={segment}
            sheet={sheet}
            model={model}
            acceptanceSlot={segment.chapter.kind === "acceptance" ? acceptanceSlot : undefined}
          />
        ))}
      </div>
      <footer className="proposal-page-footer">
        <span>{book.cover.businessName}</span>
        <span>{pageNumber}</span>
      </footer>
    </article>
  )
}

const READER_CSS = `
  .proposal-reader {
    --pp-page-shadow: 0 24px 70px -34px rgba(15, 23, 42, 0.38);
    color: var(--pp-ink);
    font-family: var(--pp-body-font);
    overflow-x: hidden;
  }
  .proposal-reader-toolbar {
    display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between;
    padding: 14px 0; border-bottom: 1px solid var(--pp-rule);
    position: sticky; top: 0; z-index: 30;
    background: color-mix(in srgb, var(--pp-paper) 92%, transparent);
    backdrop-filter: blur(14px);
  }
  .proposal-reader-brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .proposal-reader-brand .proposal-brand-mark { max-height: 54px; max-width: 192px; overflow: hidden; }
  .proposal-reader-brand .proposal-brand-mark img { max-height: 42px; max-width: 180px; width: auto; height: auto; object-fit: contain; }
  .proposal-reader-brand-copy { display: flex; flex-direction: column; min-width: 0; }
  .proposal-reader-brand-copy strong { font-size: 13px; letter-spacing: 0.01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .proposal-reader-brand-copy span { font-family: var(--pp-eyebrow-font); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--pp-muted); }
  .proposal-reader-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .proposal-reader-button {
    border: 1px solid var(--pp-rule); background: var(--pp-paper); color: var(--pp-ink);
    border-radius: 999px; padding: 8px 13px; font: inherit; font-size: 12px; font-weight: 600;
    cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 6px;
  }
  .proposal-reader-button:hover { border-color: var(--pp-accent); color: var(--pp-accent); }
  .proposal-reader-button[aria-pressed="true"] { background: var(--pp-accent); border-color: var(--pp-accent); color: var(--pp-accent-contrast); }
  .proposal-reader-button:focus-visible, .proposal-toc-panel button:focus-visible, .proposal-page-controls button:focus-visible {
    outline: 2px solid var(--pp-accent); outline-offset: 3px;
  }
  .proposal-toc-layer { position: fixed; inset: 0; z-index: 70; }
  .proposal-toc-backdrop { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: rgba(15,23,42,0.22); backdrop-filter: blur(2px); cursor: default; }
  .proposal-toc-panel {
    position: absolute; right: clamp(16px, 4vw, 48px); top: clamp(70px, 10vh, 110px);
    width: min(360px, calc(100vw - 32px)); max-height: min(72vh, 680px); overflow: hidden;
    background: var(--pp-paper); border: 1px solid var(--pp-rule); border-radius: 16px;
    box-shadow: 0 28px 70px -30px rgba(15,23,42,.55); display: flex; flex-direction: column;
  }
  .proposal-toc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 18px 18px 14px; border-bottom: 1px solid var(--pp-rule); }
  .proposal-toc-title { margin: 3px 0 0; font-family: var(--pp-heading-font); font-size: 18px; font-weight: 600; }
  .proposal-toc-close { border: 1px solid var(--pp-rule); background: var(--pp-paper); color: var(--pp-ink); border-radius: 999px; padding: 6px 10px; font: inherit; font-size: 11px; font-weight: 600; cursor: pointer; }
  .proposal-toc-list { overflow-y: auto; padding: 8px; }
  .proposal-toc-list button {
    display: flex; align-items: center; justify-content: space-between; gap: 14px; width: 100%;
    border: 0; background: transparent; color: var(--pp-ink); text-align: left; border-radius: 9px;
    padding: 10px 10px; font: inherit; font-size: 12.5px; line-height: 1.35; cursor: pointer;
  }
  .proposal-toc-list button:hover { background: var(--pp-paper-alt); }
  .proposal-toc-list button.is-active { background: var(--pp-accent-soft); color: var(--pp-accent); font-weight: 600; }
  .proposal-toc-number { display: inline-block; min-width: 26px; font-family: var(--pp-eyebrow-font); font-size: 9px; letter-spacing: .08em; color: var(--pp-muted); }
  .proposal-toc-page { font-family: var(--pp-eyebrow-font); font-size: 9px; color: var(--pp-muted); white-space: nowrap; }
  .proposal-reader-stage { padding: 22px 0 8px; }
  .proposal-spread { display: grid; grid-template-columns: minmax(0, 1fr); gap: 18px; align-items: stretch; max-width: 1320px; margin: 0 auto; }
  @media (min-width: 1024px) { .proposal-spread { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 22px; } }
  .proposal-spread--cover { grid-template-columns: minmax(0, min(720px, 100%)); justify-content: center; }
  .proposal-page {
    position: relative; min-width: 0; background: var(--pp-paper); border: 1px solid var(--pp-rule);
    border-radius: var(--pp-radius); box-shadow: var(--pp-page-shadow); padding: clamp(22px, 4vw, 48px);
    min-height: clamp(560px, 72vh, 920px); display: flex; flex-direction: column; overflow: visible;
  }
  .proposal-page--empty { display: block; visibility: hidden; }
  .proposal-spread.is-next .proposal-page { animation: ppPageNext 280ms ease both; }
  .proposal-spread.is-prev .proposal-page { animation: ppPagePrev 280ms ease both; }
  @keyframes ppPageNext { from { transform: translateX(14px); } to { transform: translateX(0); } }
  @keyframes ppPagePrev { from { transform: translateX(-14px); } to { transform: translateX(0); } }
  @media (prefers-reduced-motion: reduce) {
    .proposal-spread.is-next .proposal-page, .proposal-spread.is-prev .proposal-page { animation: none !important; }
    .proposal-reader * { scroll-behavior: auto !important; }
  }
  .proposal-cover { padding: 0; overflow: hidden; color: var(--pp-cover-ink); background: var(--pp-cover-bg); border-color: var(--pp-cover-bg); }
  .proposal-cover-media { position: absolute; inset: 0; }
  .proposal-cover-media img { width: 100%; height: 100%; object-fit: cover; }
  .proposal-cover-shade {
    position: absolute; inset: 0;
    background:
      linear-gradient(90deg, var(--pp-cover-bg) 0%, var(--pp-cover-bg) 58%, rgba(0,0,0,0.28) 82%, rgba(0,0,0,0.58) 100%),
      linear-gradient(180deg, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0.42) 60%, rgba(0,0,0,0.64) 100%);
  }
  .proposal-cover--minimal .proposal-cover-shade { background: linear-gradient(155deg, rgba(255,255,255,0.06), rgba(255,255,255,0.32)); }
  .proposal-cover-pattern { position: absolute; inset: 0; }
  .proposal-cover-pattern.pattern-grid { background-image: linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px); background-size: 32px 32px; }
  .proposal-cover-pattern.pattern-orbs { background: radial-gradient(circle at 82% 18%, var(--pp-accent) 0, transparent 34%), radial-gradient(circle at 14% 86%, rgba(255,255,255,0.08) 0, transparent 36%); }
  .proposal-cover-pattern.pattern-rules { background: repeating-linear-gradient(180deg, transparent 0 37px, rgba(0,0,0,0.06) 37px 38px); }
  .proposal-cover--custom .proposal-cover-pattern { opacity: 0.72; }
  .proposal-cover--custom .proposal-cover-shade { background: var(--pp-cover-overlay); }
  .proposal-cover--scrim .proposal-cover-copy,
  .proposal-cover--scrim .proposal-cover-meta {
    background: var(--pp-cover-scrim);
    border-radius: 6px;
    padding: 18px;
  }
  .proposal-cover--scrim .proposal-cover-copy { padding-bottom: 18px; }
  .proposal-cover-inner { position: relative; z-index: 1; display: flex; flex-direction: column; min-height: 72vh; padding: clamp(24px, 5vw, 56px); }
  .proposal-cover-brand { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; font-size: 12px; font-weight: 600; }
  .proposal-cover-brand .proposal-brand-mark { background: #fff; padding: 6px; border-radius: 8px; max-height: 58px; max-width: 172px; overflow: hidden; }
  .proposal-cover-brand .proposal-brand-mark img { max-height: 46px; max-width: 160px; width: auto; height: auto; object-fit: contain; }
  .proposal-cover-copy { margin-top: auto; padding: 42px 0 30px; }
  .proposal-eyebrow { margin: 0; font-family: var(--pp-eyebrow-font); font-size: 10px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--pp-accent); }
  .proposal-cover .proposal-eyebrow { color: var(--pp-cover-muted); }
  .proposal-cover h1 { margin: 12px 0 22px; max-width: var(--pp-cover-title-max, 13ch); font-family: var(--pp-heading-font); font-size: calc(clamp(34px, 6vw, 66px) * var(--pp-cover-title-scale, 1)); line-height: 0.98; font-weight: 600; letter-spacing: -0.04em; }
  .proposal-cover-client { display: flex; flex-direction: column; gap: 4px; border-left: 2px solid var(--pp-accent); padding-left: 14px; }
  .proposal-cover-client span, .proposal-cover-meta span { font-family: var(--pp-eyebrow-font); font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--pp-cover-muted); }
  .proposal-cover-client strong { font-size: 17px; }
  .proposal-cover-client em { font-style: normal; font-size: 12px; color: var(--pp-cover-muted); }
  .proposal-cover-meta { display: flex; flex-wrap: wrap; gap: 18px 32px; border-top: 1px solid var(--pp-cover-rule); padding-top: 16px; }
  .proposal-cover-meta div { display: flex; flex-direction: column; gap: 3px; }
  .proposal-cover-meta strong { font-size: 11px; font-weight: 600; }
  .proposal-cover-footer { position: absolute; z-index: 1; left: clamp(24px, 5vw, 56px); right: clamp(24px, 5vw, 56px); bottom: 18px; display: flex; justify-content: space-between; font-family: var(--pp-eyebrow-font); font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--pp-cover-muted); }
  .proposal-sheet-chapters { display: flex; flex-direction: column; gap: 0; min-width: 0; }
  .proposal-chapter { display: flex; flex-direction: column; gap: 18px; }
  .proposal-chapter + .proposal-chapter { border-top: 1px solid var(--pp-rule); margin-top: 28px; padding-top: 28px; }
  .proposal-chapter--continued .proposal-chapter-head h2 { font-size: clamp(18px, 2.4vw, 26px); }
  .proposal-chapter--continued .proposal-chapter-number { opacity: 0.18; }
  .proposal-chapter-head { display: flex; gap: 16px; align-items: flex-start; border-bottom: 1px solid var(--pp-rule); padding-bottom: 16px; }
  .proposal-chapter-number { min-width: 40px; font-family: var(--pp-heading-font); font-size: clamp(26px, 3.2vw, 40px); line-height: 0.88; color: var(--pp-accent); opacity: 0.28; }
  .proposal-chapter-head h2 { margin: 4px 0 0; font-family: var(--pp-heading-font); font-size: clamp(23px, 3vw, 34px); line-height: 1.06; font-weight: 600; letter-spacing: -0.02em; }
  .proposal-chapter-body { display: flex; flex-direction: column; gap: 13px; }
  .proposal-chapter--lead .proposal-body-text:first-of-type { font-size: 17px; line-height: 1.75; }
  .proposal-section-heading { margin: 9px 0 0; font-family: var(--pp-heading-font); font-size: 17px; line-height: 1.2; font-weight: 600; }
  .proposal-body-text { margin: 0; white-space: pre-wrap; font-size: 14.5px; line-height: 1.72; orphans: 3; widows: 3; }
  .proposal-bullet-list { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 7px; font-size: 14.5px; line-height: 1.6; }
  .proposal-bullet-list li::marker { color: var(--pp-accent); }
  .proposal-chapter--two-col .proposal-bullet-list { display: block; columns: 2; column-gap: 22px; }
  .proposal-chapter--two-col .proposal-bullet-list li { break-inside: avoid; margin-bottom: 7px; }
  .proposal-chapter--timeline .proposal-bullet-list { list-style: none; padding-left: 16px; border-left: 1px solid var(--pp-rule); }
  .proposal-chapter--timeline .proposal-bullet-list li { position: relative; padding-left: 4px; }
  .proposal-chapter--timeline .proposal-bullet-list li::before { content: ""; position: absolute; left: -21px; top: 8px; width: 7px; height: 7px; border-radius: 50%; background: var(--pp-accent); }
  .proposal-figure { margin: 4px 0; display: flex; flex-direction: column; gap: 7px; }
  .proposal-image-frame {
    position: relative; display: flex; align-items: center; justify-content: center;
    width: 100%; overflow: hidden; border-radius: var(--pp-radius);
    border: 1px solid var(--pp-rule); background: var(--pp-paper-alt);
  }
  .proposal-image-frame img { display: block; width: 100%; height: 100%; object-fit: contain; }
  .proposal-image-frame--full { max-height: 420px; }
  .proposal-image-fallback {
    display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;
    min-height: 120px; padding: 18px; color: var(--pp-muted); font-size: 12px;
    text-align: center; background: var(--pp-paper-alt);
  }
  .proposal-figure figcaption, .proposal-caption { font-size: 11px; color: var(--pp-muted); }
  .proposal-chapter--image-text .proposal-chapter-body { display: block; }
  .proposal-chapter--image-text .proposal-chapter-body > * + * { margin-top: 13px; }
  .proposal-chapter--image-text .proposal-figure {
    float: right; width: min(46%, 340px); margin: 0 0 14px 20px;
  }
  .proposal-chapter--image-text .proposal-figure .proposal-image-frame { max-height: 340px; }
  .proposal-chapter--image-text .proposal-chapter-body::after { content: ""; display: block; clear: both; }
  .proposal-gallery-wrap { display: flex; flex-direction: column; gap: 8px; }
  .proposal-gallery { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; align-items: start; }
  .proposal-gallery .proposal-image-frame { max-height: 260px; }
  .proposal-divider { border: 0; border-top: 1px solid var(--pp-rule); margin: 8px 0; width: 100%; }
  .proposal-pricing { margin: 8px 0 0; padding: clamp(16px, 3vw, 28px); background: var(--pp-card); border: 1px solid var(--pp-rule); border-radius: calc(var(--pp-radius) + 4px); }
  .proposal-pricing-fixed .proposal-fixed-row { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 10px; margin-top: 12px; padding: 16px 0; border-top: 1px solid var(--pp-rule); border-bottom: 1px solid var(--pp-rule); }
  .proposal-fixed-row span { font-size: 13px; color: var(--pp-muted); }
  .proposal-fixed-row strong { font-family: var(--pp-heading-font); font-size: clamp(28px, 4vw, 40px); font-weight: 600; }
  .proposal-price-table-wrap { overflow-x: auto; margin-top: 12px; }
  .proposal-price-table { width: 100%; min-width: 420px; border-collapse: collapse; font-size: 13px; }
  .proposal-price-table th, .proposal-price-table td { padding: 10px 8px; border-bottom: 1px solid var(--pp-rule); text-align: left; vertical-align: top; }
  .proposal-price-table thead th { font-family: var(--pp-eyebrow-font); font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--pp-muted); font-weight: 700; }
  .proposal-price-table .num { text-align: right; white-space: nowrap; }
  .proposal-price-table .strong { font-weight: 700; }
  .proposal-price-table tfoot td { border-top: 1px solid var(--pp-ink); border-bottom: 0; padding-top: 14px; font-size: 14px; font-weight: 600; }
  .proposal-pricing-note { margin: 14px 0 0; font-size: 10.5px; line-height: 1.5; color: var(--pp-muted); }
  .proposal-custom-pricing { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
  .proposal-rate-group { border: 1px solid var(--pp-rule); border-radius: var(--pp-radius); overflow: hidden; }
  .proposal-rate-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(120px, 38%); gap: 12px; padding: 10px 12px; border-bottom: 1px solid var(--pp-rule); font-size: 13px; }
  .proposal-rate-row:last-child { border-bottom: 0; }
  .proposal-rate-value { text-align: right; font-weight: 600; overflow-wrap: anywhere; }
  .proposal-rate-label { overflow-wrap: anywhere; }
  .proposal-rate-heading { margin: 10px 0 0; font-family: var(--pp-eyebrow-font); font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--pp-muted); }
  .proposal-spacer { height: 8px; }
  .proposal-attachments { border-top: 1px solid var(--pp-rule); padding-top: 16px; }
  .proposal-attachments h3 { margin: 0 0 10px; font-family: var(--pp-heading-font); font-size: 17px; }
  .proposal-attachments ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
  .proposal-attachments li { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; font-size: 13px; }
  .proposal-attachments a { color: var(--pp-accent); font-weight: 600; text-decoration: none; }
  .proposal-attachments span { color: var(--pp-muted); font-size: 10px; }
  .proposal-acceptance { border: 1px solid var(--pp-rule); border-radius: calc(var(--pp-radius) + 4px); padding: clamp(16px, 3vw, 26px); background: var(--pp-card); }
  .proposal-acceptance-slot { margin-bottom: 18px; }
  .proposal-acceptance-status { border-top: 1px solid var(--pp-rule); margin-top: 18px; padding-top: 16px; }
  .proposal-acceptance--status-only .proposal-acceptance-status { border-top: 0; margin-top: 0; padding-top: 0; }
  .proposal-acceptance-status-title { margin: 0 0 5px; font-family: var(--pp-heading-font); font-size: 17px; font-weight: 600; }
  .proposal-acceptance-status p { margin: 0; font-size: 13px; line-height: 1.6; color: var(--pp-muted); }
  .proposal-acceptance-status.is-accepted .proposal-acceptance-status-title { color: #047857; }
  .proposal-acceptance-status.is-rejected .proposal-acceptance-status-title { color: #b91c1c; }
  .proposal-acceptance-note { margin: 12px 0 0; font-size: 10.5px; line-height: 1.5; color: var(--pp-muted); }
  .proposal-page-footer { display: flex; justify-content: space-between; gap: 12px; margin-top: auto; padding-top: 22px; border-top: 1px solid var(--pp-rule); color: var(--pp-muted); font-family: var(--pp-eyebrow-font); font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; }
  .proposal-reader-controls { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 0 4px; }
  .proposal-page-controls { display: flex; align-items: center; gap: 8px; }
  .proposal-page-controls button { border: 1px solid var(--pp-rule); background: var(--pp-paper); color: var(--pp-ink); border-radius: 999px; padding: 8px 12px; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
  .proposal-page-controls button:disabled { opacity: 0.35; cursor: not-allowed; }
  .proposal-progress { flex: 1; min-width: 110px; height: 4px; background: var(--pp-rule); border-radius: 999px; overflow: hidden; }
  .proposal-progress span { display: block; height: 100%; background: var(--pp-accent); transition: width 220ms ease; }
  .proposal-progress-label { font-family: var(--pp-eyebrow-font); font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--pp-muted); white-space: nowrap; }
  .proposal-continuous { display: flex; flex-direction: column; gap: 22px; max-width: 980px; margin: 0 auto; }
  .proposal-continuous .proposal-page { min-height: 0; }
  .proposal-reader-empty { padding: 60px 20px; text-align: center; color: var(--pp-muted); }
  @media (max-width: 1023px) {
    .proposal-page { min-height: 0; padding: 24px 20px; border-radius: max(2px, calc(var(--pp-radius) - 4px)); }
    .proposal-cover-inner { min-height: 70vh; }
    .proposal-cover h1 { max-width: 100%; }
    .proposal-chapter-number { min-width: 34px; }
    .proposal-price-table { min-width: 0; }
  }
  @media (max-width: 639px) {
    .proposal-reader-toolbar { position: static; }
    .proposal-reader-brand-copy { display: none; }
    .proposal-reader-brand .proposal-brand-mark { max-width: 118px; max-height: 42px; }
    .proposal-reader-brand .proposal-brand-mark img { max-height: 32px; max-width: 110px; }
    .proposal-toc-backdrop { background: rgba(15,23,42,0.42); }
    .proposal-toc-panel { left: 0; right: 0; top: auto; bottom: 0; width: 100%; max-height: 78vh; border-radius: 18px 18px 0 0; }
    .proposal-toc-head { padding: 16px 16px 12px; }
    .proposal-toc-list { padding: 8px 8px 18px; }
    .proposal-cover { min-height: 72vh; }
    .proposal-cover-inner { min-height: 72vh; padding: 24px 20px 54px; }
    .proposal-cover-brand .proposal-brand-mark { max-height: 50px; max-width: 140px; padding: 5px; }
    .proposal-cover-brand .proposal-brand-mark img { max-height: 40px; max-width: 130px; }
    .proposal-cover-media { opacity: 0.3; filter: blur(1px); }
    .proposal-cover-shade { background: linear-gradient(180deg, rgba(0,0,0,0.42), rgba(0,0,0,0.86)); }
    .proposal-cover h1 { font-size: calc(clamp(32px, 10.5vw, 46px) * var(--pp-cover-title-scale, 1)); }
    .proposal-cover-meta { gap: 12px 20px; }
    .proposal-cover-footer { left: 20px; right: 20px; }
    .proposal-body-text, .proposal-bullet-list { font-size: 15px; }
    .proposal-chapter--two-col .proposal-bullet-list { columns: 1; }
    .proposal-chapter--image-text .proposal-figure { float: none; width: 100%; margin: 0 0 8px; }
    .proposal-gallery { grid-template-columns: 1fr; }
    .proposal-price-table { table-layout: fixed; font-size: 11px; }
    .proposal-price-table th, .proposal-price-table td { padding: 8px 4px; word-break: break-word; }
    .proposal-price-table .qty { width: 32px; }
    .proposal-price-table .discount { width: 58px; }
    .proposal-price-table .amount { width: 86px; }
  }
  .proposal-reader[data-template="standard_v1"] .proposal-cover-shade { background: none; }
  .proposal-reader[data-template="standard_v1"] .proposal-cover-meta { border-color: var(--pp-rule); }
  .proposal-reader[data-template="standard_v1"] .proposal-cover-brand .proposal-brand-mark { background: transparent; padding: 0; }
  .proposal-reader[data-template="minimal_v1"] .proposal-chapter-head { border-bottom-width: 1px; }
  .proposal-reader[data-template="minimal_v1"] .proposal-chapter-number { opacity: 0.2; }
  .proposal-reader[data-template="minimal_v1"] .proposal-cover { color: var(--pp-cover-ink); background: var(--pp-cover-bg); }
  .proposal-reader[data-template="minimal_v1"] .proposal-cover-shade { background: none; }
  .proposal-reader[data-template="minimal_v1"] .proposal-cover--custom .proposal-cover-shade { background: var(--pp-cover-overlay); }
  .proposal-reader[data-template="minimal_v1"] .proposal-cover-brand .proposal-brand-mark { background: transparent; padding: 0; }
  .proposal-reader[data-template="minimal_v1"] .proposal-cover--custom .proposal-cover-brand .proposal-brand-mark { background: #fff; padding: 6px; }
  .proposal-reader[data-template="minimal_v1"] .proposal-cover .proposal-eyebrow,
  .proposal-reader[data-template="minimal_v1"] .proposal-cover-client span,
  .proposal-reader[data-template="minimal_v1"] .proposal-cover-meta span,
  .proposal-reader[data-template="minimal_v1"] .proposal-cover-footer { color: var(--pp-cover-muted); }
  .proposal-reader[data-template="minimal_v1"] .proposal-cover-meta { border-color: var(--pp-cover-rule); }
  .proposal-reader[data-template="minimal_v1"] .proposal-section-heading { font-weight: 500; }
  .proposal-reader[data-template="modern_v1"] .proposal-chapter-head { border-bottom: 2px solid var(--pp-accent); }
  .proposal-reader[data-template="modern_v1"] .proposal-chapter-number { opacity: 0.75; }
  .proposal-reader[data-template="modern_v1"] .proposal-page { border-top: 3px solid var(--pp-accent); }
  .proposal-reader[data-template="modern_v1"] .proposal-section-heading { text-transform: uppercase; letter-spacing: 0.06em; font-size: 12px; color: var(--pp-accent); }
  .proposal-reader[data-template="modern_v1"] .proposal-pricing { background: var(--pp-paper-alt); }
  .proposal-reader[data-template="premium_v1"] .proposal-page { background-image: linear-gradient(180deg, rgba(255,255,255,0.38), transparent 28%); }
  .proposal-reader[data-template="premium_v1"] .proposal-chapter-head h2 { font-weight: 400; }
  .proposal-reader[data-template="premium_v1"] .proposal-chapter-number { font-style: italic; opacity: 0.45; }
  .proposal-reader[data-template="premium_v1"] .proposal-section-heading { font-weight: 500; }
  .proposal-reader[data-template="premium_v1"] .proposal-body-text { font-size: 15px; line-height: 1.78; }
  .proposal-reader[data-template="premium_v1"] .proposal-chapter-head { border-bottom-color: color-mix(in srgb, var(--pp-accent) 35%, var(--pp-rule)); }
`

function spreadForPage(pageIndex: number): number {
  if (pageIndex <= 0) return 0
  return 1 + Math.floor((pageIndex - 1) / 2)
}

export function ProposalReader({
  model,
  mode = "public",
  pdfHref,
  acceptanceSlot,
  className,
}: {
  model: ProposalRenderModel
  mode?: "public" | "preview"
  pdfHref?: string
  acceptanceSlot?: ReactNode
  className?: string
}) {
  const book = useMemo(() => composeProposalBook(model), [model])
  const sheets = useMemo(() => buildReaderSheets(book.chapters, model.pricing), [book.chapters, model.pricing])
  const chapterStarts = useMemo(() => chapterStartSheetIndex(sheets), [sheets])
  const chapterIndexByKey = useMemo(
    () => new Map(book.chapters.map((chapter, index) => [chapter.key, index])),
    [book.chapters]
  )
  const pages = useMemo<ReaderPage[]>(
    () => [
      { kind: "cover", key: "cover" },
      ...sheets.map((sheet) => ({ kind: "sheet" as const, key: sheet.key, sheet })),
    ],
    [sheets]
  )
  const spreads = useMemo<ReaderSpread[]>(() => {
    const result: ReaderSpread[] = [{ left: 0, right: null }]
    let index = 1
    while (index < pages.length) {
      result.push({ left: index, right: index + 1 < pages.length ? index + 1 : null })
      index += 2
    }
    return result
  }, [pages.length])

  const [isDesktop, setIsDesktop] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [spreadIndex, setSpreadIndex] = useState(0)
  const [pageIndex, setPageIndex] = useState(0)
  const [direction, setDirection] = useState<"next" | "prev">("next")
  const [continuous, setContinuous] = useState(false)
  const [tocOpen, setTocOpen] = useState(false)
  const touchStart = useRef<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 1024px)")
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    const sync = () => {
      setIsDesktop(desktopQuery.matches)
      setReducedMotion(motionQuery.matches)
    }
    sync()
    desktopQuery.addEventListener?.("change", sync)
    motionQuery.addEventListener?.("change", sync)
    return () => {
      desktopQuery.removeEventListener?.("change", sync)
      motionQuery.removeEventListener?.("change", sync)
    }
  }, [])

  useEffect(() => {
    setSpreadIndex((current) => Math.min(current, spreads.length - 1))
    setPageIndex((current) => Math.min(current, pages.length - 1))
  }, [pages.length, spreads.length])

  const activePage = pageIndex

  const canPrevious = isDesktop ? spreadIndex > 0 : pageIndex > 0
  const canNext = isDesktop ? spreadIndex < spreads.length - 1 : pageIndex < pages.length - 1

  const goPrevious = useCallback(() => {
    if (!canPrevious) return
    setDirection("prev")
    if (isDesktop) {
      const next = Math.max(0, spreadIndex - 1)
      setSpreadIndex(next)
      setPageIndex(spreads[next]?.left ?? spreads[next]?.right ?? 0)
    } else {
      setPageIndex((current) => Math.max(0, current - 1))
    }
  }, [canPrevious, isDesktop, spreadIndex, spreads])

  const goNext = useCallback(() => {
    if (!canNext) return
    setDirection("next")
    if (isDesktop) {
      const next = Math.min(spreads.length - 1, spreadIndex + 1)
      setSpreadIndex(next)
      setPageIndex(spreads[next]?.left ?? spreads[next]?.right ?? 0)
    } else {
      setPageIndex((current) => Math.min(pages.length - 1, current + 1))
    }
  }, [canNext, isDesktop, pages.length, spreadIndex, spreads])

  const goToPage = useCallback(
    (page: number) => {
      const clamped = Math.max(0, Math.min(pages.length - 1, page))
      setDirection(clamped >= activePage ? "next" : "prev")
      setPageIndex(clamped)
      setSpreadIndex(spreadForPage(clamped))
      if (continuous) {
        window.requestAnimationFrame(() => {
          document.getElementById(`proposal-page-${clamped}`)?.scrollIntoView({ block: "start" })
        })
      }
    },
    [activePage, continuous, pages.length]
  )

  const goToChapter = useCallback(
    (chapterIndex: number) => {
      const chapter = book.chapters[chapterIndex]
      if (!chapter) return
      const start = chapterStarts.get(chapter.key) ?? 0
      goToPage(start + 1)
      setTocOpen(false)
    },
    [book.chapters, chapterStarts, goToPage]
  )

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(event.target.tagName)) {
      return
    }
    if (event.key === "ArrowRight" || event.key === "PageDown") {
      event.preventDefault()
      goNext()
    } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault()
      goPrevious()
    } else if (event.key === "Home") {
      event.preventDefault()
      goToPage(0)
    } else if (event.key === "End") {
      event.preventDefault()
      goToPage(pages.length - 1)
    } else if (event.key === "Escape") {
      setTocOpen(false)
    }
  }

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    touchStart.current = event.touches[0]?.clientX ?? null
  }
  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    if (touchStart.current == null) return
    const endX = event.changedTouches[0]?.clientX ?? touchStart.current
    const delta = endX - touchStart.current
    touchStart.current = null
    if (Math.abs(delta) < 48) return
    if (delta < 0) goNext()
    else goPrevious()
  }

  const progress = pages.length > 0 ? ((activePage + 1) / pages.length) * 100 : 0
  const activeSheet = activePage > 0 ? sheets[activePage - 1] : null
  const activeChapterIndex = activeSheet?.segments[0]
    ? chapterIndexByKey.get(activeSheet.segments[0].chapter.key) ?? -1
    : -1
  const activeSpread = spreads[spreadIndex]
  const pageLabel =
    isDesktop && activeSpread?.right != null
      ? `Pages ${activeSpread.left! + 1}–${activeSpread.right + 1} of ${pages.length}`
      : `Page ${activePage + 1} of ${pages.length}`
  const currentTemplate = book.theme.id
  const style = {
    ...proposalThemeCssVariables(book.theme),
    ...proposalCoverCssVariables(book.cover.style),
  } as CSSProperties

  const renderPage = (page: ReaderPage, pageNumber: number, keySuffix: string) =>
    page.kind === "cover" ? (
      <CoverPage key={`${page.key}-${keySuffix}`} book={book} />
    ) : (
      <ReaderSheetPage
        key={`${page.key}-${keySuffix}`}
        sheet={page.sheet}
        book={book}
        model={model}
        pageNumber={pageNumber}
        acceptanceSlot={page.sheet.segments.some((segment) => segment.chapter.kind === "acceptance")
          ? acceptanceSlot
          : undefined}
      />
    )

  return (
    <div
      ref={rootRef}
      className={`proposal-reader ${className ?? ""}`.trim()}
      data-template={currentTemplate}
      style={style}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="region"
      aria-label={`${book.cover.title} proposal reader`}
    >
      <style>{READER_CSS}</style>

      <div className="proposal-reader-toolbar">
        <div className="proposal-reader-brand">
          <BrandMark logoUrl={book.cover.businessLogoUrl} businessName={book.cover.businessName} />
          <div className="proposal-reader-brand-copy">
            <strong>{book.cover.businessName}</strong>
            <span>{mode === "preview" ? "Staff preview" : "Client proposal"}</span>
          </div>
        </div>
        <div className="proposal-reader-actions">
          <button
            type="button"
            className="proposal-reader-button"
            aria-expanded={tocOpen}
            onClick={() => setTocOpen((open) => !open)}
          >
            Contents
          </button>
          <button
            type="button"
            className="proposal-reader-button"
            aria-pressed={continuous}
            onClick={() => setContinuous((current) => !current)}
          >
            {continuous ? "Book mode" : "Continuous scroll"}
          </button>
          {pdfHref ? (
            <a className="proposal-reader-button" href={pdfHref} target="_blank" rel="noreferrer">
              Download PDF
            </a>
          ) : null}
          <span className="proposal-progress-label" aria-live="polite">
            {pageLabel}
          </span>
        </div>
      </div>

      {tocOpen ? (
        <div className="proposal-toc-layer">
          <button
            type="button"
            className="proposal-toc-backdrop"
            aria-label="Close contents"
            onClick={() => setTocOpen(false)}
          />
          <nav className="proposal-toc-panel" aria-label="Proposal contents">
            <div className="proposal-toc-head">
              <div>
                <p className="proposal-eyebrow">Contents</p>
                <p className="proposal-toc-title">Proposal chapters</p>
              </div>
              <button type="button" className="proposal-toc-close" onClick={() => setTocOpen(false)}>
                Close
              </button>
            </div>
            <div className="proposal-toc-list">
              <button
                type="button"
                className={activePage === 0 ? "is-active" : ""}
                aria-current={activePage === 0 ? "page" : undefined}
                onClick={() => {
                  goToPage(0)
                  setTocOpen(false)
                }}
              >
                <span>Cover</span>
                <span className="proposal-toc-page">1</span>
              </button>
              {book.chapters.map((chapter, index) => {
                const active = activeChapterIndex === index
                return (
                  <button
                    key={chapter.key}
                    type="button"
                    className={active ? "is-active" : ""}
                    aria-current={active ? "page" : undefined}
                    onClick={() => goToChapter(index)}
                  >
                    <span>
                      <span className="proposal-toc-number">{String(index + 1).padStart(2, "0")}</span>
                      {chapter.title}
                    </span>
                    <span className="proposal-toc-page">
                      {chapterReaderPageNumber(chapterStarts, chapter.key)}
                    </span>
                  </button>
                )
              })}
            </div>
          </nav>
        </div>
      ) : null}

      {pages.length === 0 ? (
        <div className="proposal-reader-empty">This proposal has no content yet.</div>
      ) : continuous ? (
        <div className="proposal-continuous" id="proposal-continuous">
          {pages.map((page, index) =>
            page.kind === "cover" ? (
              <CoverPage key="cover" book={book} />
            ) : (
              <ReaderSheetPage
                key={page.key}
                sheet={page.sheet}
                book={book}
                model={model}
                pageNumber={index + 1}
                acceptanceSlot={page.sheet.segments.some(
                  (segment) => segment.chapter.kind === "acceptance"
                )
                  ? acceptanceSlot
                  : undefined}
              />
            )
          )}
        </div>
      ) : (
        <div
          className="proposal-reader-stage"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          aria-live="polite"
        >
          {isDesktop ? (
            spreadIndex === 0 ? (
              <div className="proposal-spread proposal-spread--cover">
                {renderPage(pages[0], 1, "cover")}
              </div>
            ) : (
              <div className={`proposal-spread ${direction === "next" ? "is-next" : "is-prev"}`}>
                {spreads[spreadIndex]?.left != null ? (
                  renderPage(pages[spreads[spreadIndex].left!], spreads[spreadIndex].left! + 1, "left")
                ) : (
                  <div className="proposal-page proposal-page--empty" aria-hidden />
                )}
                {spreads[spreadIndex]?.right != null ? (
                  renderPage(pages[spreads[spreadIndex].right!], spreads[spreadIndex].right! + 1, "right")
                ) : (
                  <div className="proposal-page proposal-page--empty" aria-hidden />
                )}
              </div>
            )
          ) : (
            <div className="proposal-spread">
              {renderPage(pages[pageIndex], pageIndex + 1, "mobile")}
            </div>
          )}
        </div>
      )}

      <div className="proposal-reader-controls">
        <div className="proposal-page-controls">
          <button type="button" onClick={goPrevious} disabled={!canPrevious} aria-label="Previous page">
            ← Previous
          </button>
          <button type="button" onClick={goNext} disabled={!canNext} aria-label="Next page">
            Next →
          </button>
        </div>
        <div className="proposal-progress" aria-hidden>
          <span style={{ width: `${progress}%` }} />
        </div>
        <span className="proposal-progress-label">
          {reducedMotion ? "Reduced motion" : "Use arrow keys or swipe"} · {mode === "preview" ? "Preview" : "Read"}
        </span>
      </div>
    </div>
  )
}


