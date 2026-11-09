"use client"

import { getProposalTheme } from "@/lib/proposals/design"
import type { ProposalTemplateMeta } from "@/lib/proposals/templates"

/**
 * Compact, renderer-derived preview. Colours and typography come from the same
 * theme tokens used by the reader/PDF; this is not a stock mockup.
 */
export function ProposalTemplatePreview({
  template,
  selected,
  onSelect,
}: {
  template: ProposalTemplateMeta
  selected: boolean
  onSelect: () => void
}) {
  const theme = getProposalTheme(template.id)
  const darkCover = theme.coverStyle === "modern" || theme.coverStyle === "premium"
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`group block w-full rounded-2xl border p-3 text-left transition ${
        selected
          ? "border-slate-900 bg-slate-900 text-white shadow-md ring-2 ring-slate-900/10"
          : "border-slate-200 bg-white text-slate-800 shadow-sm hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
      }`}
    >
      <div className="overflow-hidden rounded-xl border border-slate-200/70 bg-slate-100 p-2">
        <div className="grid grid-cols-[1.05fr_1fr] gap-2">
          <div
            className="relative flex aspect-[4/5] flex-col justify-between overflow-hidden rounded-md p-3"
            style={{
              background: theme.coverBg,
              color: theme.coverInk,
              fontFamily: theme.headingFont,
            }}
          >
            <div
              className="absolute inset-0 opacity-30"
              style={{
                background:
                  theme.coverStyle === "modern"
                    ? `radial-gradient(circle at 80% 18%, ${theme.accent} 0, transparent 40%)`
                    : theme.coverStyle === "premium"
                      ? `radial-gradient(circle at 82% 20%, ${theme.accent} 0, transparent 42%)`
                      : `repeating-linear-gradient(180deg, transparent 0 12px, ${theme.rule} 12px 13px)`,
              }}
            />
            <div className="relative flex items-center gap-1.5">
              <span
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[6px] font-bold"
                style={{
                  background: darkCover ? "rgba(255,255,255,0.92)" : theme.accent,
                  color: darkCover ? theme.coverBg : theme.accentContrast,
                }}
              >
                A
              </span>
              <span className="text-[6px] font-semibold uppercase tracking-[0.14em] opacity-80">
                {theme.coverStyle === "premium" ? "Editorial" : theme.coverStyle === "modern" ? "Modern" : "Minimal"}
              </span>
            </div>
            <div className="relative">
              <div
                className="mb-1.5 h-1 w-5 rounded-full"
                style={{ background: theme.accent }}
              />
              <div className="text-[13px] leading-[0.95] font-semibold tracking-[-0.03em]">
                Proposal
                <br />
                title
              </div>
              <div className="mt-3 text-[5px] uppercase tracking-[0.16em] opacity-60">
                Prepared for your client
              </div>
            </div>
          </div>
          <div
            className="flex aspect-[4/5] flex-col gap-2 overflow-hidden rounded-md p-3"
            style={{ background: theme.paper, color: theme.ink, fontFamily: theme.bodyFont }}
          >
            <div className="flex items-center justify-between">
              <span
                className="text-[5px] font-bold uppercase tracking-[0.18em]"
                style={{ color: theme.accent }}
              >
                {theme.coverStyle === "premium" ? "Chapter 01" : "Proposal"}
              </span>
              <span className="h-1 w-4 rounded-full" style={{ background: theme.rule }} />
            </div>
            <div
              className="text-[10px] leading-[1.05] font-semibold tracking-[-0.02em]"
              style={{ color: theme.ink }}
            >
              {theme.coverStyle === "modern" ? "A clear, confident section heading" : "A considered section heading"}
            </div>
            <div className="mt-1 space-y-1">
              {[0, 1, 2, 3].map((line) => (
                <div
                  key={line}
                  className="h-[3px] rounded-full"
                  style={{
                    background: theme.rule,
                    width: line === 3 ? "62%" : line === 2 ? "88%" : "100%",
                  }}
                />
              ))}
            </div>
            <div
              className="mt-auto rounded-md border p-2"
              style={{ borderColor: theme.rule, background: theme.card }}
            >
              <div
                className="text-[5px] font-bold uppercase tracking-[0.16em]"
                style={{ color: theme.muted }}
              >
                Investment
              </div>
              <div
                className="mt-1 text-[9px] font-semibold tabular-nums"
                style={{ color: theme.accent }}
              >
                GHS 12,500.00
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-start justify-between gap-2">
        <div>
          <span className="block text-sm font-semibold">{template.label}</span>
          <span className={`mt-1 block text-xs leading-relaxed ${selected ? "text-slate-300" : "text-slate-500"}`}>
            {template.description}
          </span>
        </div>
        <span
          className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] ${
            selected ? "border-white/40 bg-white text-slate-900" : "border-slate-300 text-transparent"
          }`}
          aria-hidden
        >
          ✓
        </span>
      </div>
    </button>
  )
}
