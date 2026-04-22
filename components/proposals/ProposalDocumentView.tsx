"use client"

import { createElement, useMemo, type ReactNode } from "react"
import type { ProposalRenderModel } from "@/lib/proposals/renderModel"
import type { ProposalRenderSection } from "@/lib/proposals/renderModel"
import type { PricingPayload } from "@/lib/proposals/schema"
import { chunkCustomPricingForDisplay, parseCustomPricingNotes } from "@/lib/proposals/parseCustomPricing"
import { splitForInvestmentPlacement } from "@/lib/proposals/investmentPlacement"
import {
  PROPOSAL_PRICING_SECTION_HEADING,
  PROPOSAL_PRICING_SECTION_INTRO,
} from "@/lib/proposals/pricingSectionCopy"
import { formatMoney } from "@/lib/money"

function CustomPricingBlocks({ notes }: { notes: string }) {
  const chunks = useMemo(() => chunkCustomPricingForDisplay(parseCustomPricingNotes(notes)), [notes])
  const nodes: ReactNode[] = []
  let key = 0

  for (const chunk of chunks) {
    if (chunk.kind === "rate_group") {
      nodes.push(
        <div
          key={`cp-rg-${key++}`}
          className="mt-2 overflow-hidden rounded-lg border border-slate-200/90 bg-slate-50/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
        >
          {chunk.rows.map((r, ri) => (
            <div
              key={ri}
              className="grid grid-cols-1 gap-1 border-b border-slate-200/80 px-3 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(10.5rem,38%)] sm:items-start sm:gap-x-5 sm:px-3.5 sm:py-2.5"
            >
              <span className="min-w-0 text-[14px] font-medium leading-snug text-slate-700 [overflow-wrap:anywhere]">{r.label}</span>
              <span className="text-[14px] font-semibold leading-snug text-slate-900 sm:text-right tabular-nums [overflow-wrap:anywhere]">
                {r.value}
              </span>
            </div>
          ))}
        </div>
      )
      continue
    }
    if (chunk.kind === "bullet_group") {
      nodes.push(
        <ul
          key={`cp-bg-${key++}`}
          className="mt-2 list-disc space-y-1 pl-5 text-[14px] leading-snug text-slate-700 marker:text-slate-400"
        >
          {chunk.items.map((t, j) => (
            <li key={j}>{t}</li>
          ))}
        </ul>
      )
      continue
    }

    const b = chunk.block
    switch (b.type) {
      case "spacer":
        nodes.push(<div key={`cp-sp-${key++}`} className="h-2 shrink-0" aria-hidden />)
        break
      case "heading":
        nodes.push(
          <p key={`cp-h-${key++}`} className="mb-1.5 mt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 first:mt-0">
            {b.text}
          </p>
        )
        break
      case "paragraph":
        nodes.push(
          <p key={`cp-p-${key++}`} className="mt-1.5 text-[14px] leading-relaxed text-slate-700">
            {b.text}
          </p>
        )
        break
      default:
        break
    }
  }

  return <div className="space-y-0">{nodes}</div>
}

function PricingPanel({ pricing, currencyCode }: { pricing: PricingPayload; currencyCode: string | null }) {
  const code = currencyCode || undefined
  if (pricing.mode === "none") {
    return <p className="text-base text-slate-600">Pricing to be confirmed.</p>
  }
  if (pricing.mode === "fixed") {
    return (
      <div className="rounded-2xl border border-slate-200/90 bg-gradient-to-br from-slate-50 to-white p-8 shadow-sm">
        {pricing.label ? (
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{pricing.label}</p>
        ) : null}
        <p className="mt-1 text-4xl font-bold tracking-tight text-slate-900 tabular-nums">{formatMoney(pricing.amount, code)}</p>
      </div>
    )
  }
  if (pricing.mode === "line_items") {
    const showDisc = pricing.items.some((it) => {
      const d = (it as { discount_amount?: number }).discount_amount
      return d != null && d > 0
    })
    return (
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-[15px]">
          <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3.5">Description</th>
              <th className="px-5 py-3.5 text-right">Qty</th>
              {showDisc ? <th className="px-5 py-3.5 text-right">Discount</th> : null}
              <th className="px-5 py-3.5 text-right whitespace-nowrap">Amount</th>
            </tr>
          </thead>
          <tbody>
            {pricing.items.map((it, i) => {
              const disc = (it as { discount_amount?: number }).discount_amount ?? 0
              const line =
                it.line_total != null
                  ? it.line_total
                  : it.unit_price != null && it.quantity != null
                    ? it.unit_price * it.quantity - (showDisc ? disc : 0)
                    : it.unit_price ?? 0
              return (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-5 py-3.5 align-top text-slate-800">{it.description}</td>
                  <td className="px-5 py-3.5 text-right tabular-nums text-slate-600">{it.quantity != null ? it.quantity : "—"}</td>
                  {showDisc ? (
                    <td className="px-5 py-3.5 text-right tabular-nums text-slate-600">
                      {disc > 0 ? formatMoney(disc, code) : "—"}
                    </td>
                  ) : null}
                  <td className="px-5 py-3.5 text-right text-base font-semibold tabular-nums text-slate-900">
                    {formatMoney(Number(line), code)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }
  const customRaw = (pricing.notes ?? "").trim()
  if (!customRaw) {
    return (
      <div className="rounded-xl border border-slate-200/95 bg-white px-4 py-4 shadow-sm sm:px-5 sm:py-4">
        <p className="text-sm text-slate-600">Custom pricing — see discussion.</p>
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-slate-200/95 bg-white px-4 py-3.5 shadow-sm sm:px-5 sm:py-4">
      <CustomPricingBlocks notes={pricing.notes ?? ""} />
    </div>
  )
}

function renderSectionBlock(s: ProposalRenderSection, key: string, doc: boolean): ReactNode {
  switch (s.type) {
    case "heading": {
      const L = Math.min(6, Math.max(1, s.level))
      const tags = ["h1", "h2", "h3", "h4", "h5", "h6"] as const
      const tag = tags[L - 1]
      const size =
        doc && L <= 2
          ? L === 1
            ? "text-3xl sm:text-4xl tracking-tight"
            : "text-2xl sm:text-3xl tracking-tight border-b border-slate-100 pb-2"
          : doc
            ? "text-lg sm:text-xl"
            : ""
      return createElement(
        tag,
        {
          key,
          className: `font-bold text-slate-900 first:mt-0 ${doc ? `mt-10 ${size}` : "mt-6"}`,
        },
        s.text
      )
    }
    case "paragraph":
      return (
        <p key={key} className={`whitespace-pre-wrap leading-relaxed ${doc ? "mt-4 text-[15px] text-slate-700" : "text-sm"}`}>
          {s.text}
        </p>
      )
    case "bullet_list":
      return (
        <ul key={key} className={`list-disc pl-5 ${doc ? "mt-4 space-y-2 text-[15px] text-slate-700" : "space-y-1 text-sm"}`}>
          {s.items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      )
    case "image":
      return (
        <figure key={key} className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={s.src} alt="" className="max-h-[480px] w-full rounded-lg border border-slate-200 object-contain" />
          {s.caption ? <figcaption className="text-center text-xs text-slate-500">{s.caption}</figcaption> : null}
        </figure>
      )
    case "gallery":
      return (
        <div key={key} className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {s.images.map((im) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={im.assetId}
                src={im.src}
                alt=""
                className="h-44 w-full rounded-lg border border-slate-200 object-cover"
              />
            ))}
          </div>
          {s.caption ? <p className="text-center text-xs text-slate-500">{s.caption}</p> : null}
        </div>
      )
    case "divider":
      return <hr key={key} className={doc ? "my-10 border-slate-200" : "my-6 border-slate-200"} />
    default:
      return null
  }
}

function ProposalDocumentBody({
  model,
  docTypography,
}: {
  model: ProposalRenderModel
  /** Premium single-column proposal typography (preview, public, print) */
  docTypography: boolean
}) {
  const { lead, investment, tail } = splitForInvestmentPlacement(model.sections)
  const mapBlocks = (blocks: ProposalRenderSection[], keyPrefix: string) =>
    blocks.map((s, idx) => renderSectionBlock(s, `${keyPrefix}-${s.type}-${idx}`, docTypography))

  const showPricingInBody = model.pricing.mode !== "none"
  const showInvestmentShell = investment.length > 0 || showPricingInBody

  return (
    <>
      <div className={docTypography ? "min-w-0 space-y-10 text-[15px] leading-relaxed text-slate-800" : "min-w-0 space-y-4 text-slate-800"}>
        <div className={docTypography ? "space-y-6" : "space-y-4"}>{mapBlocks(lead, "lead")}</div>

        {showInvestmentShell ? (
          <section
            className={
              docTypography
                ? "rounded-2xl border border-slate-200/90 bg-gradient-to-b from-slate-50/95 to-white px-6 py-8 shadow-sm sm:px-10 sm:py-10"
                : "rounded-2xl border border-slate-200/90 bg-gradient-to-b from-slate-50/95 to-white px-5 py-6 shadow-sm sm:px-8 sm:py-8"
            }
            aria-label={PROPOSAL_PRICING_SECTION_HEADING}
          >
            {investment.length > 0 ? <div className="space-y-4">{mapBlocks(investment, "inv")}</div> : null}
            {showPricingInBody ? (
              <div className={investment.length > 0 ? "mt-10 border-t border-slate-200/80 pt-10" : ""}>
                {investment.length === 0 ? (
                  <div className="mb-6">
                    <h2 className="text-2xl font-bold tracking-tight text-slate-900">{PROPOSAL_PRICING_SECTION_HEADING}</h2>
                    <p className="mt-2 text-sm text-slate-600">{PROPOSAL_PRICING_SECTION_INTRO}</p>
                  </div>
                ) : null}
                <PricingPanel pricing={model.pricing} currencyCode={model.currency_code} />
              </div>
            ) : null}
          </section>
        ) : null}

        <div className={docTypography ? "space-y-6" : "space-y-4"}>{mapBlocks(tail, "tail")}</div>

        {model.attachments.length > 0 ? (
          <section className={docTypography ? "border-t border-slate-200 pt-10" : "border-t border-slate-200 pt-8"}>
            <h2 className={`font-semibold text-slate-900 ${docTypography ? "text-xl" : "text-lg"}`}>Supporting documents</h2>
            <ul className={`mt-4 space-y-2 ${docTypography ? "text-[15px]" : "text-sm"}`}>
              {model.attachments.map((a) => (
                <li key={a.id}>
                  <a href={a.url} className="font-medium text-blue-700 hover:underline" target="_blank" rel="noreferrer">
                    {a.file_name}
                  </a>
                  <span className="ml-2 text-slate-500">({a.mime_type})</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  )
}

export function ProposalDocumentView({
  model,
  variant = "screen",
  /** When true with variant screen, matches public/PDF document layout (editor preview + staff preview page). */
  previewLayout = false,
}: {
  model: ProposalRenderModel
  variant?: "screen" | "public" | "print"
  previewLayout?: boolean
}) {
  const unifiedDocument = previewLayout || variant === "public" || variant === "print"

  const wrap =
    variant === "public"
      ? "w-full max-w-4xl mx-auto rounded-2xl border border-slate-200/90 bg-white shadow-[0_20px_50px_-28px_rgba(15,23,42,0.18)]"
      : variant === "print"
        ? "max-w-3xl mx-auto py-2 print:max-w-none"
        : previewLayout
          ? "w-full max-w-none rounded-sm border border-slate-200/80 bg-white shadow-[0_25px_80px_-40px_rgba(15,23,42,0.35)]"
          : "max-w-3xl mx-auto rounded-2xl border border-slate-200 bg-white shadow-sm"

  const inner =
    variant === "screen"
      ? previewLayout
        ? "p-8 sm:p-12 lg:p-14"
        : "p-6 sm:p-9"
      : variant === "public"
        ? "p-6 sm:p-10 lg:p-12"
        : "p-4 sm:p-6"

  const bizLabel = model.business.trading_name || model.business.legal_name || model.business.name
  const printSurface =
    unifiedDocument
      ? "proposal-print-document print:max-w-none print:shadow-none print:rounded-md print:border print:border-slate-300"
      : ""

  return (
    <article className={`${wrap} ${inner} ${printSurface}`.trim()}>
      <header
        className={`mb-8 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between ${unifiedDocument ? "border-b border-slate-100 pb-8" : ""}`}
      >
        <div className="flex items-start gap-4">
          {model.business.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={model.business.logo_url}
              alt=""
              className={
                unifiedDocument
                  ? "h-20 w-auto max-w-[min(280px,100%)] object-contain sm:h-24 sm:max-w-[320px]"
                  : "h-16 w-auto max-w-[220px] object-contain"
              }
            />
          ) : null}
          <div>
            <h1 className={`font-bold tracking-tight text-slate-900 ${unifiedDocument ? "text-3xl sm:text-4xl" : "text-2xl"}`}>
              {model.title || "Proposal"}
            </h1>
            <p className={`mt-2 text-slate-500 ${unifiedDocument ? "text-base" : "text-sm"}`}>{bizLabel}</p>
            {model.proposal_number ? (
              <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-400">Ref {model.proposal_number}</p>
            ) : null}
          </div>
        </div>
        {model.customer ? (
          <div className={`text-right ${unifiedDocument ? "text-base" : "text-sm"}`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Prepared for</p>
            <p className="font-semibold text-slate-900">{model.customer.name}</p>
            {model.customer.email ? <p className="text-slate-600">{model.customer.email}</p> : null}
          </div>
        ) : null}
      </header>

      <ProposalDocumentBody model={model} docTypography />
    </article>
  )
}
