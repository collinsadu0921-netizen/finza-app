"use client"

import BusinessLogoDisplay from "@/components/BusinessLogoDisplay"
import { getProposalTheme } from "@/lib/proposals/design"
import { resolveProposalCoverStyle } from "@/lib/proposals/coverStyle"
import type { ProposalTemplateId } from "@/lib/proposals/templates"

export function CoverDesignPreview({
  templateId,
  accentColor,
  typography,
  backgroundColor,
  imageUrl,
  imagePosition,
  title,
  businessName,
  logoUrl,
  customerName,
}: {
  templateId: ProposalTemplateId
  accentColor: string
  typography: string
  backgroundColor: string
  imageUrl: string | null
  imagePosition: string
  title: string
  businessName: string
  logoUrl: string | null
  customerName: string | null
}) {
  const theme = getProposalTheme(templateId, {
    accentColor: accentColor || null,
    typography,
  })
  const style = resolveProposalCoverStyle({
    templateId,
    accentColor: accentColor || null,
    typography,
    backgroundColor: backgroundColor || null,
    imagePosition,
    hasImage: Boolean(imageUrl),
    title,
  })

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div
        role="img"
        aria-label="Live proposal cover preview"
        className="relative min-h-[260px] overflow-hidden p-6"
        style={{
          backgroundColor: style.backgroundColor,
          color: style.ink,
          fontFamily: theme.headingFont,
        }}
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            style={{ objectPosition: style.imagePosition }}
          />
        ) : null}
        {style.overlay ? (
          <div className="absolute inset-0" style={{ background: style.overlay }} aria-hidden />
        ) : null}
        {style.coverPattern !== "none" && !imageUrl ? (
          <div
            className="absolute inset-0 opacity-20"
            aria-hidden
            style={{
              backgroundImage:
                style.coverPattern === "grid"
                  ? "linear-gradient(rgba(255,255,255,.18) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.18) 1px, transparent 1px)"
                  : style.coverPattern === "orbs"
                    ? `radial-gradient(circle at 82% 18%, ${style.accent} 0, transparent 36%)`
                    : "repeating-linear-gradient(180deg, transparent 0 30px, rgba(0,0,0,.08) 30px 31px)",
              backgroundSize: style.coverPattern === "grid" ? "28px 28px" : undefined,
            }}
          />
        ) : null}
        <div
          className="relative flex min-h-[212px] flex-col"
          style={style.scrim ? { background: style.scrim, padding: 14, borderRadius: 6 } : undefined}
        >
          <div className="flex items-center gap-3 text-[11px] font-semibold">
            <span className="inline-flex max-h-10 max-w-[135px] items-center overflow-hidden rounded bg-white p-1">
              <BusinessLogoDisplay
                logoUrl={logoUrl}
                businessName={businessName}
                variant="document"
                brandingResolved
                className="max-h-8 max-w-[120px]"
              />
            </span>
            <span className="truncate">{businessName}</span>
          </div>
          <div className="mt-auto pt-8">
            <p
              className="text-[9px] font-bold uppercase tracking-[0.16em]"
              style={{ color: style.muted }}
            >
              Proposal
            </p>
            <h3
              className="mt-1 line-clamp-3 text-[26px] font-semibold leading-[1.02] tracking-tight"
              style={{ fontFamily: theme.headingFont }}
            >
              {title.trim() || "Proposal title"}
            </h3>
            {customerName ? (
              <p className="mt-3 text-[11px]" style={{ color: style.muted }}>
                Prepared for <strong style={{ color: style.ink }}>{customerName}</strong>
              </p>
            ) : null}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">
        <span>Live cover preview</span>
        <span className="font-mono uppercase">{style.backgroundColor}</span>
      </div>
    </div>
  )
}
