"use client"

import { useEffect, useMemo, useState } from "react"
import type { ProposalSectionBlock } from "@/lib/proposals/schema"
import type {
  ProposalAiPreview,
  ProposalAiResponse,
  ProposalAiSnapshot,
} from "@/lib/proposals/ai/types"

const REFINEMENT_ACTIONS = [
  "Improve writing",
  "Make more professional",
  "Shorten",
  "Expand",
  "Fix grammar",
  "Make more persuasive",
  "Rewrite for clarity",
] as const

type ChapterPreview = {
  title: string
  blocks: ProposalSectionBlock[]
}

function previewChapters(sections: ProposalSectionBlock[]): ChapterPreview[] {
  const out: ChapterPreview[] = []
  let current: ChapterPreview | null = null
  for (const section of sections) {
    if (section.type === "heading" && section.level === 2) {
      current = { title: section.text.trim() || "Untitled chapter", blocks: [] }
      out.push(current)
    } else if (current) {
      current.blocks.push(section)
    }
  }
  return out
}

function formatCost(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "n/a"
  return `$${value.toFixed(5)}`
}

function formatTokens(value: number | null): string {
  return value == null ? "n/a" : value.toLocaleString("en-US")
}

export function ProposalAiAssistant({
  proposalId,
  businessId,
  open,
  onClose,
  disabled,
  snapshot,
  chapters,
  proposalStatus,
  onApply,
}: {
  proposalId: string
  businessId: string
  open: boolean
  onClose: () => void
  disabled: boolean
  snapshot: ProposalAiSnapshot
  chapters: string[]
  proposalStatus: string
  onApply: (preview: ProposalAiPreview) => void
}) {
  const [instruction, setInstruction] = useState("")
  const [chapterTitle, setChapterTitle] = useState("")
  const [newChapterTitle, setNewChapterTitle] = useState("")
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [result, setResult] = useState<ProposalAiResponse | null>(null)
  const [applied, setApplied] = useState(false)

  useEffect(() => {
    if (chapters.length === 0) {
      setChapterTitle("")
      return
    }
    setChapterTitle((current) => (current && chapters.includes(current) ? current : chapters[0]))
  }, [chapters])

  const preview = result?.ok ? result.preview : null
  const previewChaptersList = useMemo(
    () => (preview ? previewChapters(preview.sections) : []),
    [preview]
  )
  const previewPricing = useMemo(() => {
    if (!preview || preview.pricing_mode === "none") return null
    const currency = snapshot.currency_code || "GHS"
    const raw = preview.pricing_payload
    const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
    const format = (value: number) =>
      `${currency} ${new Intl.NumberFormat("en-GH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(value)}`
    if (preview.pricing_mode === "fixed") {
      const amount = Number(record.amount) || 0
      return {
        label: typeof record.label === "string" && record.label.trim() ? record.label : "Total investment",
        lines: [] as string[],
        total: format(amount),
      }
    }
    if (preview.pricing_mode === "line_items") {
      const items = Array.isArray(record.items) ? record.items : []
      const lines: string[] = []
      let total = 0
      for (const item of items) {
        if (!item || typeof item !== "object") continue
        const row = item as Record<string, unknown>
        const quantity = Number(row.quantity) || 0
        const unit = Number(row.unit_price) || 0
        const discount = Number(row.discount_amount) || 0
        const lineTotal =
          row.line_total != null && Number.isFinite(Number(row.line_total))
            ? Number(row.line_total)
            : quantity * unit - discount
        total += lineTotal
        lines.push(`${String(row.description ?? "Line item")} — ${format(lineTotal)}`)
      }
      return { label: "Line items", lines, total: format(total) }
    }
    return {
      label: "Custom pricing",
      lines: [String(record.notes ?? "Custom pricing notes")],
      total: null,
    }
  }, [preview, snapshot.currency_code])

  async function request(args: {
    action: "generate" | "edit" | "refine" | "generate_section"
    instruction: string
    chapterTitle?: string
  }) {
    const text = args.instruction.trim()
    if (text.length < 3) {
      setError("Describe what you want the assistant to do.")
      return
    }
    setBusyAction(args.action)
    setError("")
    setApplied(false)
    setResult(null)
    try {
      const response = await fetch(`/api/proposals/${proposalId}/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          business_id: businessId,
          action: args.action,
          instruction: text,
          snapshot,
          ...(args.chapterTitle ? { chapter_title: args.chapterTitle } : {}),
        }),
      })
      const data = (await response.json().catch(() => null)) as ProposalAiResponse | null
      if (!response.ok || !data || !data.ok) {
        setError(
          data && "error" in data ? data.error : "The proposal assistant could not complete this request."
        )
        return
      }
      setResult(data)
    } catch {
      setError("The proposal assistant could not be reached. Check your connection and try again.")
    } finally {
      setBusyAction(null)
    }
  }

  function applyPreview() {
    if (!preview) return
    if (result?.ok && busyAction === null) {
      const confirmed = window.confirm(
        "Apply these AI changes to the editor? Nothing is saved until you click Save. Review the affected chapters before saving."
      )
      if (!confirmed) return
      onApply(preview)
      setApplied(true)
      setResult(null)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/30 backdrop-blur-[1px]"
        onClick={onClose}
        aria-label="Close AI proposal assistant"
      />
      <aside
        className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-slate-200 bg-white shadow-2xl"
        aria-label="AI proposal assistant"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Finza AI
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">
              Proposal assistant
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Uses your saved company profile, selected customer and current draft. Nothing is applied
              until you approve it, and nothing is saved until you click Save.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            Close
          </button>
        </header>

        <div className="space-y-6 px-5 py-5">
          {disabled ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              This proposal is locked in its current status. AI changes are disabled.
            </div>
          ) : null}

          {!disabled && (proposalStatus === "sent" || proposalStatus === "viewed") ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              This proposal has already been sent to the client. Applying AI changes changes the
              client-facing document; review carefully and resend or confirm the update intentionally.
            </div>
          ) : null}

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          ) : null}

          <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
            <h3 className="text-sm font-semibold text-slate-900">Draft from an instruction</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Describe the client, work, duration, price and anything the proposal must include. This
              replaces the current narrative after approval.
            </p>
            <textarea
              className="mt-3 min-h-[120px] w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm leading-relaxed text-slate-800 shadow-sm"
              placeholder="Prepare a professional proposal for ABC Company. We will provide office cleaning three times per week for six months at GHS 4,500 monthly. Include offices, washrooms, meeting rooms and common areas."
              value={instruction}
              maxLength={4000}
              onChange={(event) => setInstruction(event.target.value)}
              disabled={disabled || busyAction !== null}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
                disabled={disabled || busyAction !== null || instruction.trim().length < 3}
                onClick={() => void request({ action: "generate", instruction })}
              >
                {busyAction === "generate" ? "Generating…" : "Generate proposal draft"}
              </button>
              <span className="text-[11px] text-slate-500">Preview appears below before applying.</span>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-slate-900">Targeted changes</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Ask for a specific change. Only the affected chapters or pricing are proposed.
            </p>
            <label className="mt-3 block text-xs font-medium text-slate-600">
              Instruction
              <textarea
                className="mt-1 min-h-[80px] w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm leading-relaxed text-slate-800 shadow-sm"
                placeholder="Change the monthly amount to GHS 5,000. Make the payment terms 50% upfront."
                value={instruction}
                maxLength={4000}
                onChange={(event) => setInstruction(event.target.value)}
                disabled={disabled || busyAction !== null}
              />
            </label>
            <button
              type="button"
              className="mt-3 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
              disabled={disabled || busyAction !== null || instruction.trim().length < 3}
              onClick={() => void request({ action: "edit", instruction })}
            >
              {busyAction === "edit" ? "Preparing changes…" : "Propose changes"}
            </button>

            <div className="mt-5 border-t border-slate-100 pt-4">
              <label className="block text-xs font-medium text-slate-600">
                Refine a chapter
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={chapterTitle}
                  onChange={(event) => setChapterTitle(event.target.value)}
                  disabled={disabled || busyAction !== null || chapters.length === 0}
                >
                  {chapters.length === 0 ? <option value="">No chapters yet</option> : null}
                  {chapters.map((title) => (
                    <option key={title} value={title}>
                      {title}
                    </option>
                  ))}
                </select>
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                {REFINEMENT_ACTIONS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-40"
                    disabled={disabled || busyAction !== null || !chapterTitle}
                    onClick={() =>
                      void request({
                        action: "refine",
                        instruction: preset,
                        chapterTitle,
                      })
                    }
                  >
                    {busyAction === "refine" ? "…" : preset}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 border-t border-slate-100 pt-4">
              <label className="block text-xs font-medium text-slate-600">
                Generate a missing chapter
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="e.g. Warranty and support"
                  value={newChapterTitle}
                  maxLength={160}
                  onChange={(event) => setNewChapterTitle(event.target.value)}
                  disabled={disabled || busyAction !== null}
                />
              </label>
              <button
                type="button"
                className="mt-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                disabled={
                  disabled ||
                  busyAction !== null ||
                  newChapterTitle.trim().length < 3 ||
                  instruction.trim().length < 3
                }
                onClick={() =>
                  void request({
                    action: "generate_section",
                    instruction,
                    chapterTitle: newChapterTitle.trim(),
                  })
                }
              >
                {busyAction === "generate_section" ? "Generating…" : "Generate chapter"}
              </button>
            </div>
          </section>

          {preview ? (
            <section className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-emerald-950">Proposed revision</h3>
                  <p className="mt-1 text-xs leading-relaxed text-emerald-900">
                    {result?.ok ? result.summary : ""}
                  </p>
                </div>
                <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-800 ring-1 ring-emerald-200">
                  Not applied
                </span>
              </div>

              {preview.changed_chapters.length > 0 ? (
                <p className="mt-3 text-xs text-emerald-900">
                  <span className="font-semibold">Affected:</span> {preview.changed_chapters.join(", ")}
                </p>
              ) : null}
              {preview.warnings.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-900">
                  {preview.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-3 max-h-72 overflow-y-auto rounded-xl border border-emerald-100 bg-white p-3">
                <p className="text-base font-semibold tracking-tight text-slate-900">{preview.title}</p>
                {preview.customer_hint?.customer_name ? (
                  <p className="mt-1 text-xs text-slate-600">
                    Suggested customer: {preview.customer_hint.customer_name}
                  </p>
                ) : null}
                {previewPricing ? (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      {previewPricing.label}
                    </p>
                    {previewPricing.lines.length > 0 ? (
                      <ul className="mt-1 space-y-0.5 text-[11px] text-slate-700">
                        {previewPricing.lines.map((line, index) => (
                          <li key={index}>{line}</li>
                        ))}
                      </ul>
                    ) : null}
                    {previewPricing.total ? (
                      <p className="mt-1 text-xs font-semibold text-slate-900">
                        Total: {previewPricing.total}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <div className="mt-3 space-y-4">
                  {previewChaptersList.map((chapter) => (
                    <div key={chapter.title}>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {chapter.title}
                      </p>
                      <div className="mt-1 space-y-1.5">
                        {chapter.blocks.map((block, index) => {
                          if (block.type === "paragraph") {
                            return (
                              <p key={index} className="text-xs leading-relaxed text-slate-700">
                                {block.text}
                              </p>
                            )
                          }
                          if (block.type === "bullet_list") {
                            return (
                              <ul key={index} className="list-disc space-y-1 pl-4 text-xs text-slate-700">
                                {block.items.map((item, itemIndex) => (
                                  <li key={itemIndex}>{item}</li>
                                ))}
                              </ul>
                            )
                          }
                          return null
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="rounded-lg bg-emerald-700 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800"
                  onClick={applyPreview}
                >
                  Apply to editor
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  onClick={() => {
                    setResult(null)
                    setApplied(false)
                  }}
                >
                  Reject
                </button>
                <span className="text-[11px] text-slate-500">Review the editor, then Save.</span>
              </div>
            </section>
          ) : null}

          {applied ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              Changes applied to the editor. Review every affected field and click Save when ready.
            </div>
          ) : null}

          {result?.ok ? (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-[11px] leading-relaxed text-slate-500">
              <p>
                <span className="font-semibold text-slate-700">Model:</span> {result.usage.model} ·{" "}
                <span className="font-semibold text-slate-700">Latency:</span>{" "}
                {result.usage.latency_ms.toLocaleString("en-US")} ms
              </p>
              <p className="mt-1">
                Tokens: {formatTokens(result.usage.input_tokens)} input /{" "}
                {formatTokens(result.usage.output_tokens)} output · Estimated cost:{" "}
                {formatCost(result.usage.estimated_cost_usd)}
              </p>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  )
}
