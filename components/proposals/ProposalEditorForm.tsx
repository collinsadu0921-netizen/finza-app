"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import type { ProposalSectionBlock } from "@/lib/proposals/schema"
import type { PricingMode } from "@/lib/proposals/schema"
import { parseProposalSections } from "@/lib/proposals/schema"
import { validateAndNormalizePricingForDb } from "@/lib/proposals/pricingForDb"
import { pricingPayloadForRender } from "@/lib/proposals/pricingForDb"
import {
  normalizeProposalStatus,
  PROPOSAL_STATUS_LABEL,
  proposalCanBeEditedByStaff,
  proposalConversionBlockReason,
  proposalStaffOutboundChannelsAllowed,
} from "@/lib/proposals/proposalState"
import { formatMoney } from "@/lib/money"

type CustomerOpt = { id: string; name: string; email: string | null; phone: string | null; whatsapp_phone?: string | null }

type AssetRow = {
  id: string
  kind: string
  mime_type: string
  file_name: string
  role: string
  visible_on_public: boolean
  internal_only: boolean
  sort_order: number
  signed_url: string | null
}

type LineDraft = { description: string; quantity: string; unitPrice: string; discount: string }

type CatalogOpt = { id: string; name: string; unitPrice: number; source: "service_catalog" | "products_services" }

function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `blk_${Date.now()}_${Math.random().toString(16).slice(2)}`
  }
}

function parseLineRowsFromPayload(pricingMode: string, pricingPayload: unknown): LineDraft[] {
  if (pricingMode !== "line_items") return [{ description: "", quantity: "1", unitPrice: "0", discount: "0" }]
  try {
    const raw = pricingPayload && typeof pricingPayload === "object" && !Array.isArray(pricingPayload) ? pricingPayload : {}
    const items = Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : []
    const rows: LineDraft[] = []
    for (const it of items) {
      if (!it || typeof it !== "object") continue
      const o = it as Record<string, unknown>
      const description = String(o.description ?? "").trim()
      const quantity = o.quantity != null && Number.isFinite(Number(o.quantity)) ? String(o.quantity) : "1"
      const unitPrice =
        o.unit_price != null && Number.isFinite(Number(o.unit_price))
          ? String(o.unit_price)
          : o.line_total != null && Number.isFinite(Number(o.line_total)) && Number(quantity) > 0
            ? String(Number(o.line_total) / Number(quantity))
            : "0"
      const discount =
        o.discount_amount != null && Number.isFinite(Number(o.discount_amount)) ? String(o.discount_amount) : "0"
      rows.push({ description: description || "", quantity, unitPrice, discount })
    }
    return rows.length ? rows : [{ description: "", quantity: "1", unitPrice: "0", discount: "0" }]
  } catch {
    return [{ description: "", quantity: "1", unitPrice: "0", discount: "0" }]
  }
}

function lineRowsToPayloadItems(rows: LineDraft[]) {
  return rows
    .map((r) => {
      const disc = Math.max(0, Number(r.discount) || 0)
      return {
        description: r.description.trim(),
        quantity: Math.max(0, Number(r.quantity) || 0) || 1,
        unit_price: Math.round((Number(r.unitPrice) || 0) * 100) / 100,
        ...(disc > 0 ? { discount_amount: Math.round(disc * 100) / 100 } : {}),
      }
    })
    .filter((r) => r.description.length > 0)
}

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] ring-1 ring-slate-900/[0.02]">
      <div className="rounded-t-2xl border-b border-slate-100 bg-gradient-to-b from-slate-50/80 to-white px-6 py-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
        {subtitle ? <p className="mt-1.5 text-sm leading-snug text-slate-600">{subtitle}</p> : null}
      </div>
      <div className="px-6 py-6">{children}</div>
    </section>
  )
}

const BLOCK_LABEL: Record<ProposalSectionBlock["type"], string> = {
  heading: "Heading",
  paragraph: "Paragraph",
  bullet_list: "Bullet list",
  image: "Image",
  gallery: "Gallery",
  divider: "Divider",
}

/** Preset section titles → stored as H2 + paragraph (existing schema). */
const PROPOSAL_SECTION_PRESETS = [
  "Executive summary",
  "Scope of work",
  "Deliverables",
  "Timeline",
  "Terms",
  "Acceptance",
  "Custom text",
] as const

type EditorSegment =
  | { kind: "pair"; headIdx: number; paraIdx: number }
  | { kind: "single"; idx: number }

function segmentsFromSections(sections: ProposalSectionBlock[]): EditorSegment[] {
  const out: EditorSegment[] = []
  let i = 0
  while (i < sections.length) {
    const s = sections[i]
    const next = sections[i + 1]
    if (s.type === "heading" && s.level === 2 && next?.type === "paragraph") {
      out.push({ kind: "pair", headIdx: i, paraIdx: i + 1 })
      i += 2
    } else {
      out.push({ kind: "single", idx: i })
      i += 1
    }
  }
  return out
}

export function ProposalEditorForm({
  proposalId,
  businessId,
  businessDefaultCurrency,
  businessIndustry,
}: {
  proposalId: string
  businessId: string
  businessDefaultCurrency?: string | null
  businessIndustry?: string | null
}) {
  const router = useRouter()
  const defaultCurrencyUpper = (businessDefaultCurrency || "").trim().toUpperCase() || null
  const industryLower = (businessIndustry || "").trim().toLowerCase()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [title, setTitle] = useState("")
  const [proposalRef, setProposalRef] = useState<string | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)
  const [customerId, setCustomerId] = useState<string>("")
  const [customers, setCustomers] = useState<CustomerOpt[]>([])
  const [sections, setSections] = useState<ProposalSectionBlock[]>([])
  const [pricingMode, setPricingMode] = useState<PricingMode>("none")
  const [fixedAmount, setFixedAmount] = useState("")
  const [fixedLabel, setFixedLabel] = useState("")
  const [lineRows, setLineRows] = useState<LineDraft[]>([{ description: "", quantity: "1", unitPrice: "0", discount: "0" }])
  const [customNotes, setCustomNotes] = useState("")
  const [currencyCode, setCurrencyCode] = useState("")
  const [currencyOverride, setCurrencyOverride] = useState(false)
  const [workflowStatus, setWorkflowStatus] = useState("draft")
  const [viewedAt, setViewedAt] = useState<string | null>(null)
  const [sentAt, setSentAt] = useState<string | null>(null)
  const [acceptedAt, setAcceptedAt] = useState<string | null>(null)
  const [rejectedAt, setRejectedAt] = useState<string | null>(null)
  const [rejectedReason, setRejectedReason] = useState<string | null>(null)
  const [publicToken, setPublicToken] = useState<string | null>(null)
  const [publicLink, setPublicLink] = useState("")
  const [sendBusy, setSendBusy] = useState(false)
  const [sendFeedback, setSendFeedback] = useState("")
  const [sendMenuOpen, setSendMenuOpen] = useState(false)
  const sendMenuRef = useRef<HTMLDivElement>(null)
  const [copiedTip, setCopiedTip] = useState(false)
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [convertedEstimateId, setConvertedEstimateId] = useState<string | null>(null)
  const [convertedAt, setConvertedAt] = useState<string | null>(null)
  const [convertBusy, setConvertBusy] = useState(false)
  const [convertSuccess, setConvertSuccess] = useState("")
  const [catalogOptions, setCatalogOptions] = useState<CatalogOpt[]>([])
  const [catalogSearch, setCatalogSearch] = useState("")
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const [shareLinkOpen, setShareLinkOpen] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const qs = useMemo(() => new URLSearchParams({ business_id: businessId }).toString(), [businessId])

  const displayCurrency = (currencyOverride ? currencyCode.trim().toUpperCase() : defaultCurrencyUpper || "").trim() || null
  const displayCurrencyFmt = displayCurrency || undefined

  const lineItemsPayloadCount = useMemo(() => lineRowsToPayloadItems(lineRows).length, [lineRows])

  const lineRowComputed = useMemo(() => {
    return lineRows.map((row) => {
      const qty = Math.max(0, Number(row.quantity) || 0) || 1
      const unit = Number(row.unitPrice) || 0
      const disc = Math.max(0, Number(row.discount) || 0)
      const line = Math.max(0, qty * unit - disc)
      return { qty, unit, disc, line, hasDescription: row.description.trim().length > 0 }
    })
  }, [lineRows])

  const lineItemsSubtotal = useMemo(() => lineRowComputed.reduce((s, r) => s + (r.hasDescription ? r.line : 0), 0), [lineRowComputed])

  const pricingEditorHint = useMemo(() => {
    if (pricingMode === "line_items" && lineItemsPayloadCount === 0) {
      return "Add at least one line with a description (use the service list or “Add manual line”)."
    }
    if (pricingMode === "fixed" && !(Number(fixedAmount) > 0)) {
      return "Enter a positive amount for the fixed total, or switch pricing mode."
    }
    if (pricingMode === "custom" && !customNotes.trim()) {
      return "Add a short pricing note so clients know how commercial terms work."
    }
    return null
  }, [pricingMode, lineItemsPayloadCount, fixedAmount, customNotes])

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === customerId) || null,
    [customers, customerId]
  )

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      const t = e.target as Node
      if (sendMenuOpen && sendMenuRef.current && !sendMenuRef.current.contains(t)) {
        setSendMenuOpen(false)
      }
      if (moreMenuOpen && moreMenuRef.current && !moreMenuRef.current.contains(t)) {
        setMoreMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", onDocDown)
    return () => document.removeEventListener("mousedown", onDocDown)
  }, [sendMenuOpen, moreMenuOpen])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const opts: CatalogOpt[] = []
        if (industryLower === "service") {
          const { data: cat } = await supabase
            .from("service_catalog")
            .select("id, name, default_price")
            .eq("business_id", businessId)
            .eq("is_active", true)
            .order("name", { ascending: true })
          for (const row of cat || []) {
            const r = row as { id: string; name: string; default_price?: number | null }
            opts.push({
              id: `cat:${r.id}`,
              name: r.name,
              unitPrice: Number(r.default_price) || 0,
              source: "service_catalog",
            })
          }
          const { data: ps } = await supabase
            .from("products_services")
            .select("id, name, unit_price")
            .eq("business_id", businessId)
            .eq("type", "service")
            .is("deleted_at", null)
            .order("name", { ascending: true })
          for (const row of ps || []) {
            const r = row as { id: string; name: string; unit_price?: number | null }
            opts.push({
              id: `ps:${r.id}`,
              name: r.name,
              unitPrice: Number(r.unit_price) || 0,
              source: "products_services",
            })
          }
        } else {
          const { data: ps } = await supabase
            .from("products_services")
            .select("id, name, unit_price")
            .eq("business_id", businessId)
            .is("deleted_at", null)
            .order("name", { ascending: true })
          for (const row of ps || []) {
            const r = row as { id: string; name: string; unit_price?: number | null }
            opts.push({
              id: `ps:${r.id}`,
              name: r.name,
              unitPrice: Number(r.unit_price) || 0,
              source: "products_services",
            })
          }
        }
        if (!cancelled) setCatalogOptions(opts)
      } catch {
        if (!cancelled) setCatalogOptions([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [businessId, industryLower])

  const reloadAssets = useCallback(async () => {
    const res = await fetch(`/api/proposals/${proposalId}/assets?${qs}`, { credentials: "same-origin" })
    const data = await res.json().catch(() => ({}))
    if (res.ok && Array.isArray(data.assets)) {
      setAssets(data.assets)
    }
  }, [proposalId, qs])

  const applyProposalRow = useCallback(
    (p: Record<string, unknown>) => {
      setTitle((p.title as string) || "")
      setProposalRef(((p.proposal_number as string) || "").trim() || null)
      setLastUpdatedAt((p.updated_at as string) || null)
      setCustomerId((p.customer_id as string) || "")
      setSections(parseProposalSections(p.sections))
      setPricingMode(((p.pricing_mode as PricingMode) || "none") as PricingMode)
      const rowCur = ((p.currency_code as string) || "").trim().toUpperCase()
      if (!rowCur || (defaultCurrencyUpper && rowCur === defaultCurrencyUpper)) {
        setCurrencyOverride(false)
        setCurrencyCode(defaultCurrencyUpper || rowCur || "")
      } else {
        setCurrencyOverride(true)
        setCurrencyCode(rowCur)
      }
      setWorkflowStatus((p.status as string) || "draft")
      setViewedAt((p.viewed_at as string) || null)
      setSentAt((p.sent_at as string) || null)
      setAcceptedAt((p.accepted_at as string) || null)
      setRejectedAt((p.rejected_at as string) || null)
      setRejectedReason((p.rejected_reason as string) || null)
      setPublicToken((p.public_token as string) || null)
      setConvertedEstimateId((p.converted_estimate_id as string) || null)
      setConvertedAt((p.converted_at as string) || null)
      const pr = pricingPayloadForRender(String(p.pricing_mode), p.pricing_payload)
      if (pr.mode === "fixed") {
        setFixedAmount(String(pr.amount))
        setFixedLabel(pr.label || "")
      }
      if (pr.mode === "line_items") {
        setLineRows(parseLineRowsFromPayload("line_items", p.pricing_payload))
      } else {
        setLineRows([{ description: "", quantity: "1", unitPrice: "0", discount: "0" }])
      }
      if (pr.mode === "custom") {
        setCustomNotes(pr.notes || "")
      }
    },
    [defaultCurrencyUpper]
  )

  const reloadProposalFull = useCallback(async () => {
    const propRes = await fetch(`/api/proposals/${proposalId}?${qs}`, { credentials: "same-origin" })
    const propJson = await propRes.json().catch(() => ({}))
    if (!propRes.ok) {
      throw new Error(propJson.error || "Failed to load proposal")
    }
    applyProposalRow(propJson.proposal as Record<string, unknown>)
    await reloadAssets()
  }, [applyProposalRow, proposalId, qs, reloadAssets])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        setError("")
        const [propRes, custRes] = await Promise.all([
          fetch(`/api/proposals/${proposalId}?${qs}`, { credentials: "same-origin" }),
          fetch(`/api/customers?${qs}&limit=200`, { credentials: "same-origin" }),
        ])
        const propJson = await propRes.json().catch(() => ({}))
        const custJson = await custRes.json().catch(() => ({}))
        if (!propRes.ok) {
          throw new Error(propJson.error || "Failed to load proposal")
        }
        if (cancelled) return
        applyProposalRow(propJson.proposal as Record<string, unknown>)
        if (Array.isArray(custJson.customers)) {
          setCustomers(
            custJson.customers.map((c: { id: string; name: string; email?: string | null; phone?: string | null; whatsapp_phone?: string | null }) => ({
              id: c.id,
              name: c.name,
              email: c.email ?? null,
              phone: c.phone ?? null,
              whatsapp_phone: c.whatsapp_phone ?? null,
            }))
          )
        }
        await reloadAssets()
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [proposalId, qs, reloadAssets, applyProposalRow])

  useEffect(() => {
    if (publicToken && typeof window !== "undefined") {
      setPublicLink(`${window.location.origin}/proposal-public/${encodeURIComponent(publicToken)}`)
    } else {
      setPublicLink("")
    }
  }, [publicToken])

  useEffect(() => {
    if (pricingMode === "line_items" && lineRows.length === 0) {
      setLineRows([{ description: "", quantity: "1", unitPrice: "0", discount: "0" }])
    }
  }, [pricingMode, lineRows.length])

  const imageAssets = assets.filter((a) => a.kind === "image")

  const contentSegments = useMemo(() => segmentsFromSections(sections), [sections])

  const catalogFiltered = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase()
    if (!q) return catalogOptions
    return catalogOptions.filter((o) => o.name.toLowerCase().includes(q))
  }, [catalogOptions, catalogSearch])

  function addPresetSection(presetTitle: string) {
    const idH = newId()
    const idP = newId()
    setSections((prev) => [...prev, { type: "heading", level: 2, text: presetTitle, id: idH }, { type: "paragraph", text: "", id: idP }])
  }

  function removePair(headIdx: number, paraIdx: number) {
    const lo = Math.min(headIdx, paraIdx)
    const hi = Math.max(headIdx, paraIdx)
    setSections((prev) => {
      const copy = [...prev]
      copy.splice(hi, 1)
      copy.splice(lo, 1)
      return copy
    })
  }

  function updatePairHeading(headIdx: number, text: string) {
    setSections((prev) => {
      const copy = [...prev]
      const h = copy[headIdx]
      if (h?.type === "heading") copy[headIdx] = { ...h, level: 2, text }
      return copy
    })
  }

  function updatePairBody(paraIdx: number, text: string) {
    setSections((prev) => {
      const copy = [...prev]
      const p = copy[paraIdx]
      if (p?.type === "paragraph") copy[paraIdx] = { ...p, text }
      return copy
    })
  }

  function updateBlock(index: number, next: ProposalSectionBlock) {
    setSections((prev) => {
      const copy = [...prev]
      copy[index] = next
      return copy
    })
  }

  function removeBlock(index: number) {
    setSections((prev) => prev.filter((_, i) => i !== index))
  }

  function addBlock(type: ProposalSectionBlock["type"]) {
    const id = newId()
    let b: ProposalSectionBlock
    switch (type) {
      case "heading":
        b = { type: "heading", level: 2, text: "New heading", id }
        break
      case "paragraph":
        b = { type: "paragraph", text: "", id }
        break
      case "bullet_list":
        b = { type: "bullet_list", items: ["First item"], id }
        break
      case "image":
        b = { type: "image", asset_id: imageAssets[0]?.id || "", caption: "", id }
        break
      case "gallery":
        b = { type: "gallery", asset_ids: imageAssets.slice(0, 2).map((x) => x.id), caption: "", id }
        break
      case "divider":
        b = { type: "divider", id }
        break
      default:
        b = { type: "paragraph", text: "", id }
    }
    setSections((prev) => [...prev, b])
  }

  function buildPricingPayload(): unknown {
    if (pricingMode === "none") return {}
    if (pricingMode === "fixed") {
      return { amount: Number(fixedAmount) || 0, label: fixedLabel.trim() || undefined }
    }
    if (pricingMode === "line_items") {
      const items = lineRowsToPayloadItems(lineRows)
      if (items.length === 0) throw new Error("Add at least one line item with a description.")
      return { items }
    }
    return { notes: customNotes }
  }

  async function save() {
    try {
      setSaving(true)
      setError("")
      const locked = !proposalCanBeEditedByStaff(normalizeProposalStatus(workflowStatus))
      let body: Record<string, unknown>
      if (locked) {
        body = { business_id: businessId, title }
      } else {
        let pricingPayload: unknown
        try {
          pricingPayload = buildPricingPayload()
        } catch (e: unknown) {
          throw new Error(e instanceof Error ? e.message : "Invalid pricing data")
        }
        validateAndNormalizePricingForDb(pricingMode, pricingPayload)

        const cleanedSections = sections.filter((s) => {
          if (s.type === "image") return !!s.asset_id
          if (s.type === "gallery") return Array.isArray(s.asset_ids) && s.asset_ids.length > 0
          return true
        })

        const currencyOut = currencyOverride ? currencyCode.trim().toUpperCase() || null : null

        body = {
          business_id: businessId,
          title,
          customer_id: customerId || null,
          sections: cleanedSections,
          pricing_mode: pricingMode,
          pricing_payload: pricingPayload,
          currency_code: currencyOut,
        }
      }
      const res = await fetch(`/api/proposals/${proposalId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Save failed")
      await reloadProposalFull()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  async function deleteProposal() {
    if (!proposalCanBeEditedByStaff(normalizeProposalStatus(workflowStatus))) {
      setError("This proposal can’t be deleted in its current state.")
      return
    }
    if (!window.confirm("Delete this proposal? It will be removed from your list.")) return
    try {
      setDeleteBusy(true)
      setError("")
      const res = await fetch(`/api/proposals/${proposalId}?${qs}`, {
        method: "DELETE",
        credentials: "same-origin",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Delete failed")
      router.push("/service/proposals")
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed")
    } finally {
      setDeleteBusy(false)
    }
  }

  async function onUpload(file: File) {
    setError("")
    const fd = new FormData()
    fd.append("file", file)
    const res = await fetch(`/api/proposals/${proposalId}/assets/upload?${qs}`, {
      method: "POST",
      body: fd,
      credentials: "same-origin",
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || "Upload failed")
      return
    }
    await reloadAssets()
  }

  async function patchAsset(id: string, patch: Record<string, unknown>) {
    await fetch(`/api/proposals/${proposalId}/assets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ business_id: businessId, ...patch }),
    })
    await reloadAssets()
  }

  async function deleteAsset(id: string) {
    if (!window.confirm("Remove this file from the proposal?")) return
    const res = await fetch(`/api/proposals/${proposalId}/assets/${id}?${qs}`, {
      method: "DELETE",
      credentials: "same-origin",
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error || "Delete failed")
      return
    }
    await reloadAssets()
  }

  type ProposalSendChannel = "mark_sent" | "email" | "whatsapp"

  async function sendProposal(channel: ProposalSendChannel) {
    const st = normalizeProposalStatus(workflowStatus)
    if (!proposalStaffOutboundChannelsAllowed(st)) {
      setError("This proposal can’t be sent or shared in its current state.")
      return
    }
    if (channel === "mark_sent" && st !== "draft") {
      setError("Mark as sent is only available while the proposal is a draft.")
      return
    }
    if (channel === "email" && !customerId.trim()) {
      setError("Choose a customer with an email address before sending by email.")
      return
    }
    try {
      setSendBusy(true)
      setError("")
      setSendFeedback("")
      setSendMenuOpen(false)
      const res = await fetch(`/api/proposals/${proposalId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ business_id: businessId, channel }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError((data.error as string) || (data.message as string) || "Send failed")
        return
      }
      if (typeof data.public_url === "string") {
        setPublicLink(data.public_url)
      }
      if (data.proposal?.status) setWorkflowStatus(data.proposal.status as string)
      if (data.proposal?.sent_at) setSentAt(data.proposal.sent_at as string)
      if (channel === "whatsapp" && typeof data.whatsapp_url === "string") {
        window.open(data.whatsapp_url as string, "_blank", "noopener,noreferrer")
      }
      if (channel === "email") setSendFeedback("Email sent successfully.")
      if (channel === "whatsapp") setSendFeedback("WhatsApp opened with a prefilled message and your proposal link.")
      if (channel === "mark_sent") {
        setSendFeedback(data.already_marked_sent ? "Already marked as sent." : "Marked as sent.")
      }
      await reloadProposalFull()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Send failed")
    } finally {
      setSendBusy(false)
    }
  }

  const normalizedStatus = normalizeProposalStatus(workflowStatus)
  const contentLocked = !proposalCanBeEditedByStaff(normalizedStatus)
  const convertBlockReason = useMemo(
    () =>
      proposalConversionBlockReason({
        status: normalizedStatus,
        converted_estimate_id: convertedEstimateId,
        pricing_mode: pricingMode,
      }),
    [normalizedStatus, convertedEstimateId, pricingMode]
  )
  const canConvertToEstimate = convertBlockReason === null && normalizedStatus === "accepted"

  async function convertToEstimate() {
    if (!canConvertToEstimate) return
    if (!window.confirm("Create a new draft estimate from this proposal? The proposal will be marked as converted.")) {
      return
    }
    try {
      setConvertBusy(true)
      setError("")
      setConvertSuccess("")
      const res = await fetch(`/api/proposals/${proposalId}/convert-estimate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ business_id: businessId }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409 && data.converted_estimate_id) {
        setConvertedEstimateId(data.converted_estimate_id as string)
        setError(data.error || "Already converted")
        return
      }
      if (!res.ok) {
        throw new Error(data.error || data.message || "Conversion failed")
      }
      const estId = data.estimate_id as string | undefined
      if (estId) {
        setConvertSuccess("Estimate created. Opening editor…")
        setConvertedEstimateId(estId)
        setWorkflowStatus("converted")
        window.setTimeout(() => {
          router.push(`/service/estimates/${estId}/edit`)
        }, 400)
      } else {
        await reloadProposalFull()
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Conversion failed")
    } finally {
      setConvertBusy(false)
    }
  }

  async function copyPublicLink() {
    if (!publicLink) return
    try {
      await navigator.clipboard.writeText(publicLink)
      setCopiedTip(true)
      window.setTimeout(() => setCopiedTip(false), 2000)
    } catch {
      setError("Could not copy to clipboard")
    }
  }

  function formatWhen(iso: string | null) {
    if (!iso) return "—"
    return new Date(iso).toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short" })
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-slate-500">
        Loading proposal…
      </div>
    )
  }

  const outboundOk = proposalStaffOutboundChannelsAllowed(normalizedStatus)
  const emailHint =
    !selectedCustomer?.email?.trim() && customerId
      ? "Customer has no email on file."
      : !customerId
        ? "Select a customer to send email."
        : null
  const phoneHint =
    !selectedCustomer?.phone?.trim() && !selectedCustomer?.whatsapp_phone?.trim() && customerId
      ? "No phone on file — WhatsApp will open without a pre-selected contact."
      : null

  return (
    <div className="space-y-0">
      {error ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      ) : null}

      <header className="sticky top-0 z-30 -mx-1 mb-5 border-b border-slate-200/90 bg-white/95 px-1 pb-3 pt-1 shadow-sm backdrop-blur-md supports-[backdrop-filter]:bg-white/90">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="min-w-0 flex-1 space-y-1">
              <label htmlFor="proposal-title-header" className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Proposal title
              </label>
              <input
                id="proposal-title-header"
                className="w-full border-0 border-b border-transparent bg-transparent pb-0.5 text-lg font-semibold tracking-tight text-slate-900 placeholder:text-slate-400 focus:border-slate-300 focus:outline-none sm:text-xl"
                placeholder="Proposal title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={500}
              />
              {contentLocked ? (
                <p className="text-[11px] text-slate-500">Title can still be edited; other fields are locked for this status.</p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
              <span className="inline-flex items-center rounded-full bg-slate-900 px-2 py-0.5 font-semibold text-white">
                {PROPOSAL_STATUS_LABEL[normalizedStatus]}
              </span>
              {proposalRef ? <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">Ref {proposalRef}</span> : null}
              <span className="hidden sm:inline text-slate-400">·</span>
              <span className="max-w-[18rem] truncate sm:max-w-none">
                <span className="font-medium text-slate-800">{selectedCustomer?.name || "No customer"}</span>
                {customerId && selectedCustomer?.email ? (
                  <span className="text-slate-500"> · {selectedCustomer.email}</span>
                ) : null}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
              {lastUpdatedAt ? <span>Saved {formatWhen(lastUpdatedAt)}</span> : null}
              {sentAt ? <span>Sent {formatWhen(sentAt)}</span> : null}
              {viewedAt ? <span>Viewed {formatWhen(viewedAt)}</span> : null}
              {acceptedAt ? <span className="font-medium text-emerald-800">Accepted {formatWhen(acceptedAt)}</span> : null}
              {rejectedAt ? (
                <span className="font-medium text-red-800">
                  Rejected {formatWhen(rejectedAt)}
                  {rejectedReason ? ` · “${rejectedReason}”` : ""}
                </span>
              ) : null}
            </div>
            {convertedEstimateId ? (
              <p className="text-xs text-slate-600">
                Linked quote:{" "}
                <a className="font-medium text-blue-700 hover:underline" href={`/service/estimates/${convertedEstimateId}/edit`}>
                  Open estimate
                </a>
              </p>
            ) : null}
            {sendFeedback ? <p className="text-xs font-medium text-emerald-800">{sendFeedback}</p> : null}
          </div>
          <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? "Saving…" : contentLocked ? "Save title" : "Save"}
            </button>
            {!contentLocked ? (
              <button
                type="button"
                onClick={() => void deleteProposal()}
                disabled={deleteBusy}
                className="rounded-lg border border-red-200 bg-white px-3.5 py-2 text-sm font-semibold text-red-800 shadow-sm hover:bg-red-50 disabled:opacity-50"
              >
                {deleteBusy ? "Deleting…" : "Delete"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => router.push(`/service/proposals/${proposalId}/preview`)}
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
            >
              Preview
            </button>
            <a
              href={`/api/proposals/${proposalId}/export-pdf?${qs}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
            >
              Download PDF
            </a>
            <div className="relative" ref={sendMenuRef}>
              <button
                type="button"
                onClick={() => setSendMenuOpen((o) => !o)}
                disabled={sendBusy || !outboundOk}
                className="rounded-lg bg-blue-700 px-3.5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {sendBusy ? "…" : "Send proposal"}
              </button>
              {sendMenuOpen ? (
                <div className="absolute right-0 z-40 mt-1 w-80 rounded-xl border border-slate-200 bg-white py-2 shadow-xl ring-1 ring-black/5">
                  <p className="border-b border-slate-100 px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Send &amp; share
                  </p>
                  {emailHint ? <p className="px-3 pt-2 text-[11px] text-amber-800">{emailHint}</p> : null}
                  {phoneHint ? <p className="px-3 pt-1 text-[11px] text-slate-600">{phoneHint}</p> : null}
                  <button
                    type="button"
                    className="block w-full px-3 py-2.5 text-left text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-40"
                    disabled={sendBusy || !customerId.trim()}
                    onClick={() => void sendProposal("email")}
                  >
                    Send by email
                  </button>
                  <button
                    type="button"
                    className="block w-full px-3 py-2.5 text-left text-sm text-slate-800 hover:bg-slate-50"
                    disabled={sendBusy}
                    onClick={() => void sendProposal("whatsapp")}
                  >
                    Share via WhatsApp
                  </button>
                  <button
                    type="button"
                    className="block w-full px-3 py-2.5 text-left text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-40"
                    disabled={sendBusy || normalizedStatus !== "draft"}
                    onClick={() => void sendProposal("mark_sent")}
                  >
                    Mark as sent
                  </button>
                  <button
                    type="button"
                    className="block w-full px-3 py-2.5 text-left text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-40"
                    disabled={!publicLink}
                    onClick={() => void copyPublicLink()}
                  >
                    {copiedTip ? "Link copied" : "Copy public link"}
                  </button>
                  {publicLink ? (
                    <a
                      href={publicLink}
                      target="_blank"
                      rel="noreferrer"
                      className="block px-3 py-2.5 text-sm text-blue-700 hover:bg-slate-50"
                      onClick={() => setSendMenuOpen(false)}
                    >
                      Open public page
                    </a>
                  ) : null}
                  <div className="mx-3 my-2 border-t border-slate-100 pt-2">
                    <button
                      type="button"
                      className="text-xs font-semibold text-slate-600 hover:text-slate-900"
                      onClick={() => setShareLinkOpen((o) => !o)}
                    >
                      {shareLinkOpen ? "Hide client link" : "Show client link"}
                    </button>
                    {shareLinkOpen && publicLink ? (
                      <p className="mt-2 break-all rounded-md bg-slate-50 p-2 font-mono text-[10px] leading-snug text-slate-600">{publicLink}</p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="relative" ref={moreMenuRef}>
              <button
                type="button"
                onClick={() => setMoreMenuOpen((o) => !o)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                More
              </button>
              {moreMenuOpen ? (
                <div className="absolute right-0 z-40 mt-1 w-56 rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                  <a
                    href={`/api/proposals/${proposalId}/export-pdf?${qs}`}
                    className="block px-3 py-2 text-sm text-slate-800 hover:bg-slate-50"
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setMoreMenuOpen(false)}
                  >
                    Download PDF
                  </a>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-40"
                    disabled={!publicLink}
                    onClick={() => {
                      setMoreMenuOpen(false)
                      void copyPublicLink()
                    }}
                  >
                    Copy public link
                  </button>
                  {publicLink ? (
                    <a
                      href={publicLink}
                      target="_blank"
                      rel="noreferrer"
                      className="block px-3 py-2 text-sm text-slate-800 hover:bg-slate-50"
                      onClick={() => setMoreMenuOpen(false)}
                    >
                      Open public page
                    </a>
                  ) : null}
                  <div className="my-1 border-t border-slate-100" />
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm text-emerald-900 hover:bg-emerald-50 disabled:opacity-40"
                    disabled={convertBusy || !canConvertToEstimate}
                    onClick={() => {
                      setMoreMenuOpen(false)
                      void convertToEstimate()
                    }}
                  >
                    Convert to estimate
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <div className="w-full space-y-8 pb-10">
          {acceptedAt || rejectedAt || normalizedStatus === "converted" ? (
            <div
              className={`rounded-xl border px-4 py-3 text-sm ${
                acceptedAt
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : rejectedAt
                    ? "border-red-200 bg-red-50 text-red-900"
                    : "border-slate-200 bg-slate-50 text-slate-800"
              }`}
            >
              {acceptedAt ? "This proposal was accepted by the client. You can convert it to a quote when ready." : null}
              {rejectedAt && !acceptedAt ? "This proposal was rejected by the client." : null}
              {normalizedStatus === "converted" && !acceptedAt && !rejectedAt
                ? "This proposal has been converted to an estimate."
                : null}
            </div>
          ) : null}

          <SectionCard title="Basics" subtitle="Customer and currency for amounts in the proposal. Edit the document title in the bar above.">
            <div className="space-y-5">
              <label className="block text-sm">
                <span className="font-medium text-slate-700">Customer</span>
                <select
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm shadow-sm"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  disabled={contentLocked}
                >
                  <option value="">— None —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="rounded-xl border border-slate-100 bg-slate-50/90 p-4">
                {!currencyOverride ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-slate-700">
                      <span className="font-medium text-slate-900">Currency:</span>{" "}
                      <span className="font-semibold tabular-nums text-slate-900">{defaultCurrencyUpper || "—"}</span>
                      <span className="text-slate-500"> (business default)</span>
                    </p>
                    <button
                      type="button"
                      className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                      disabled={contentLocked}
                      onClick={() => {
                        setCurrencyOverride(true)
                        setCurrencyCode(defaultCurrencyUpper || currencyCode || "GHS")
                      }}
                    >
                      Use different currency
                    </button>
                  </div>
                ) : (
                  <div className="mt-2 space-y-2">
                    <input
                      className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase shadow-sm"
                      value={currencyCode}
                      onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())}
                      placeholder="GHS"
                      maxLength={8}
                      disabled={contentLocked}
                    />
                    <button
                      type="button"
                      className="text-xs font-semibold text-slate-600 hover:text-slate-900"
                      disabled={contentLocked}
                      onClick={() => {
                        setCurrencyOverride(false)
                        setCurrencyCode(defaultCurrencyUpper || "")
                      }}
                    >
                      Use business default
                    </button>
                  </div>
                )}
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Content"
            subtitle="Executive summary, scope, timeline, terms, and other narrative blocks — each section is a heading plus body copy."
          >
            <div className={`space-y-6 ${contentLocked ? "pointer-events-none opacity-60" : ""}`}>
              <div className="space-y-4">
                {contentSegments.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-5 py-8 text-center text-sm text-slate-600">
                    No body content yet. Add a section preset below to start your narrative.
                  </p>
                ) : null}
                {contentSegments.map((seg, si) => {
                  if (seg.kind === "pair") {
                    const head = sections[seg.headIdx]
                    const para = sections[seg.paraIdx]
                    if (head?.type !== "heading" || para?.type !== "paragraph") return null
                    return (
                      <div
                        key={`pair-${seg.headIdx}-${seg.paraIdx}-${si}`}
                        className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-sm"
                      >
                        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <label className="min-w-0 flex-1 text-sm">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Section title</span>
                            <input
                              className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-base font-semibold text-slate-900 shadow-sm"
                              value={head.text}
                              onChange={(e) => updatePairHeading(seg.headIdx, e.target.value)}
                            />
                          </label>
                          <button
                            type="button"
                            className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-slate-400 hover:bg-red-50 hover:text-red-700 sm:mt-7"
                            onClick={() => removePair(seg.headIdx, seg.paraIdx)}
                          >
                            Remove
                          </button>
                        </div>
                        <label className="block text-sm">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Content</span>
                          <textarea
                            className="mt-2 min-h-[128px] w-full rounded-lg border border-slate-200 px-3 py-3 text-sm leading-relaxed text-slate-800"
                            value={para.text}
                            onChange={(e) => updatePairBody(seg.paraIdx, e.target.value)}
                            placeholder="What the client should know for this part of the proposal."
                          />
                        </label>
                      </div>
                    )
                  }
                  const idx = seg.idx
                  const block = sections[idx]
                  if (!block) return null
                  return (
                    <div
                      key={`aux-${idx}-${block.type}-${si}`}
                      className="rounded-xl border border-slate-200/90 bg-slate-50/40 p-5"
                    >
                      <div className="mb-4 flex items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{BLOCK_LABEL[block.type]}</p>
                        <button
                          type="button"
                          className="rounded-md px-2 py-1 text-xs font-medium text-slate-400 hover:bg-red-50 hover:text-red-700"
                          onClick={() => removeBlock(idx)}
                        >
                          Remove
                        </button>
                      </div>
                      <div className="space-y-3">
                        {block.type === "heading" ? (
                          <div className="grid gap-3 sm:grid-cols-4">
                            <label className="text-xs sm:col-span-1">
                              <span className="text-slate-600">Level</span>
                              <input
                                type="number"
                                min={1}
                                max={6}
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm"
                                value={block.level}
                                onChange={(e) =>
                                  updateBlock(idx, { ...block, level: Math.min(6, Math.max(1, Number(e.target.value) || 2)) })
                                }
                              />
                            </label>
                            <label className="text-xs sm:col-span-3">
                              <span className="text-slate-600">Text</span>
                              <input
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                                value={block.text}
                                onChange={(e) => updateBlock(idx, { ...block, text: e.target.value })}
                              />
                            </label>
                          </div>
                        ) : null}
                        {block.type === "paragraph" ? (
                          <label className="block text-xs">
                            <span className="text-slate-600">Paragraph</span>
                            <textarea
                              className="mt-1 min-h-[100px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed"
                              value={block.text}
                              onChange={(e) => updateBlock(idx, { ...block, text: e.target.value })}
                            />
                          </label>
                        ) : null}
                        {block.type === "bullet_list" ? (
                          <label className="block text-xs">
                            <span className="text-slate-600">One bullet per line</span>
                            <textarea
                              className="mt-1 min-h-[100px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed"
                              value={block.items.join("\n")}
                              onChange={(e) =>
                                updateBlock(idx, {
                                  ...block,
                                  items: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean),
                                })
                              }
                            />
                          </label>
                        ) : null}
                        {block.type === "image" ? (
                          <div className="space-y-2">
                            <label className="block text-xs">
                              <span className="text-slate-600">Image</span>
                              <select
                                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                                value={block.asset_id}
                                onChange={(e) => updateBlock(idx, { ...block, asset_id: e.target.value })}
                              >
                                <option value="">— Select from Media —</option>
                                {imageAssets.map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {a.file_name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <input
                              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                              placeholder="Caption (optional)"
                              value={block.caption || ""}
                              onChange={(e) => updateBlock(idx, { ...block, caption: e.target.value })}
                            />
                          </div>
                        ) : null}
                        {block.type === "gallery" ? (
                          <div className="space-y-2 text-sm">
                            <p className="text-xs text-slate-500">Choose images from Media:</p>
                            <div className="flex flex-wrap gap-2">
                              {imageAssets.map((a) => {
                                const on = block.asset_ids.includes(a.id)
                                return (
                                  <button
                                    key={a.id}
                                    type="button"
                                    onClick={() => {
                                      const next = on ? block.asset_ids.filter((x) => x !== a.id) : [...block.asset_ids, a.id]
                                      updateBlock(idx, { ...block, asset_ids: next.length ? next : [a.id] })
                                    }}
                                    className={`rounded-full px-3 py-1 text-xs font-medium ${on ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}
                                  >
                                    {a.file_name.slice(0, 28)}
                                  </button>
                                )
                              })}
                            </div>
                            <input
                              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                              placeholder="Caption (optional)"
                              value={block.caption || ""}
                              onChange={(e) => updateBlock(idx, { ...block, caption: e.target.value })}
                            />
                          </div>
                        ) : null}
                        {block.type === "divider" ? (
                          <p className="text-sm text-slate-600">A subtle divider line appears here in the proposal layout.</p>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50/50 px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Add section</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {PROPOSAL_SECTION_PRESETS.map((label) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => addPresetSection(label)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:border-slate-300 hover:bg-white"
                    >
                      + {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-dashed border-slate-200 bg-white/60 p-5">
                <p className="text-sm font-semibold text-slate-800">Visuals & lists</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  Bullets, inline images, galleries, or dividers. Upload images in <span className="font-medium text-slate-800">Media</span>{" "}
                  first, then place them here.
                </p>
                <select
                  className="mt-4 w-full max-w-md rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium shadow-sm"
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value as ProposalSectionBlock["type"] | ""
                    if (v) addBlock(v)
                    e.target.value = ""
                  }}
                >
                  <option value="" disabled>
                    Add supporting block…
                  </option>
                  <option value="bullet_list">Bullet list</option>
                  <option value="image">Inline image</option>
                  <option value="gallery">Image gallery</option>
                  <option value="divider">Divider line</option>
                  <option value="heading">Extra heading (advanced)</option>
                  <option value="paragraph">Extra paragraph (advanced)</option>
                </select>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Pricing / fee schedule"
            subtitle="How commercial terms appear in the proposal — including the Fee Schedule block in the live preview and client PDF."
          >
            <div className={`space-y-5 ${contentLocked ? "pointer-events-none opacity-60" : ""}`}>
              <label className="block text-sm font-medium text-slate-700">
                Pricing mode
                <select
                  className="mt-2 w-full max-w-lg rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm"
                  value={pricingMode}
                  onChange={(e) => setPricingMode(e.target.value as PricingMode)}
                >
                  <option value="none">No pricing</option>
                  <option value="fixed">Fixed summary</option>
                  <option value="line_items">Service line items</option>
                  <option value="custom">Custom pricing note</option>
                </select>
              </label>
              {pricingEditorHint ? (
                <div className="rounded-lg border border-amber-200/90 bg-amber-50/90 px-4 py-3 text-sm text-amber-950">{pricingEditorHint}</div>
              ) : null}
              {pricingMode === "fixed" ? (
                <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
                  <label className="text-sm">
                    <span className="font-medium text-slate-700">Amount</span>
                    <input
                      className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm tabular-nums shadow-sm"
                      placeholder="0.00"
                      value={fixedAmount}
                      onChange={(e) => setFixedAmount(e.target.value)}
                    />
                  </label>
                  <label className="text-sm">
                    <span className="font-medium text-slate-700">Label (optional)</span>
                    <input
                      className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm shadow-sm"
                      placeholder="e.g. Implementation fee"
                      value={fixedLabel}
                      onChange={(e) => setFixedLabel(e.target.value)}
                    />
                  </label>
                </div>
              ) : null}
              {pricingMode === "line_items" ? (
                <div className="space-y-6">
                  {catalogOptions.length > 0 ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Service library</p>
                      <p className="mt-1 text-sm text-slate-600">
                        Pick from your active services and catalog. Each choice adds a row to the table — you can edit wording and numbers
                        before saving.
                      </p>
                      <input
                        type="search"
                        className="mt-4 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm"
                        placeholder="Search by service name…"
                        value={catalogSearch}
                        onChange={(e) => setCatalogSearch(e.target.value)}
                      />
                      <ul className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white text-sm shadow-sm">
                        {catalogFiltered.length === 0 ? (
                          <li className="px-4 py-4 text-slate-500">No matches — try another search.</li>
                        ) : (
                          catalogFiltered.slice(0, 80).map((o) => (
                            <li key={o.id} className="border-b border-slate-100 last:border-b-0">
                              <button
                                type="button"
                                className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
                                onClick={() =>
                                  setLineRows((prev) => [
                                    ...prev,
                                    { description: o.name, quantity: "1", unitPrice: String(o.unitPrice), discount: "0" },
                                  ])
                                }
                              >
                                <span className="font-medium text-slate-900">{o.name}</span>
                                <span className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-700">
                                  {formatMoney(o.unitPrice, displayCurrencyFmt)}
                                </span>
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-600">No catalog services found — use manual lines in the table below.</p>
                  )}
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Line items</p>
                    <p className="mt-1 text-sm text-slate-600">Every saved row needs a description. Quantity defaults to 1; discount is optional.</p>
                    <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                      <table className="w-full min-w-[640px] table-fixed text-sm">
                        <colgroup>
                          <col className="w-[44%]" />
                          <col className="w-[10%]" />
                          <col className="w-[14%]" />
                          <col className="w-[14%]" />
                          <col className="w-[12%]" />
                          <col className="w-[6%]" />
                        </colgroup>
                        <thead className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-4 py-3">Description</th>
                            <th className="px-3 py-3">Qty</th>
                            <th className="px-3 py-3">Unit</th>
                            <th className="px-3 py-3">Discount</th>
                            <th className="px-3 py-3 text-right">Line</th>
                            <th className="px-2 py-3" />
                          </tr>
                        </thead>
                        <tbody>
                          {lineRows.map((row, i) => {
                            const comp = lineRowComputed[i]!
                            return (
                              <tr key={i} className="border-t border-slate-100">
                                <td className="px-3 py-3 align-top">
                                  <input
                                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                                    value={row.description}
                                    onChange={(e) => {
                                      const v = e.target.value
                                      setLineRows((prev) => prev.map((r, j) => (j === i ? { ...r, description: v } : r)))
                                    }}
                                    placeholder="Service or deliverable"
                                  />
                                </td>
                                <td className="px-2 py-3 align-top">
                                  <input
                                    className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm tabular-nums"
                                    value={row.quantity}
                                    onChange={(e) => {
                                      const v = e.target.value
                                      setLineRows((prev) => prev.map((r, j) => (j === i ? { ...r, quantity: v } : r)))
                                    }}
                                  />
                                </td>
                                <td className="px-2 py-3 align-top">
                                  <input
                                    className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm tabular-nums"
                                    value={row.unitPrice}
                                    onChange={(e) => {
                                      const v = e.target.value
                                      setLineRows((prev) => prev.map((r, j) => (j === i ? { ...r, unitPrice: v } : r)))
                                    }}
                                  />
                                </td>
                                <td className="px-2 py-3 align-top">
                                  <input
                                    className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm tabular-nums"
                                    value={row.discount}
                                    onChange={(e) => {
                                      const v = e.target.value
                                      setLineRows((prev) => prev.map((r, j) => (j === i ? { ...r, discount: v } : r)))
                                    }}
                                  />
                                </td>
                                <td className="px-3 py-3 text-right text-sm font-semibold tabular-nums text-slate-800 align-middle">
                                  {comp.hasDescription ? formatMoney(comp.line, displayCurrencyFmt) : "—"}
                                </td>
                                <td className="px-1 py-3 text-center align-middle">
                                  <button
                                    type="button"
                                    className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-700"
                                    aria-label="Remove line"
                                    onClick={() => setLineRows((prev) => prev.filter((_, j) => j !== i))}
                                  >
                                    ×
                                  </button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="border-t border-slate-200 bg-slate-50/80">
                            <td colSpan={4} className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Subtotal (described lines)
                            </td>
                            <td className="px-3 py-3 text-right text-base font-bold tabular-nums text-slate-900">
                              {formatMoney(lineItemsSubtotal, displayCurrencyFmt)}
                            </td>
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    <button
                      type="button"
                      className="mt-3 text-sm font-semibold text-blue-700 hover:text-blue-800"
                      onClick={() => setLineRows((prev) => [...prev, { description: "", quantity: "1", unitPrice: "0", discount: "0" }])}
                    >
                      + Add manual line
                    </button>
                  </div>
                </div>
              ) : null}
              {pricingMode === "custom" ? (
                <div className="space-y-2">
                  <label className="block text-sm">
                    <span className="font-medium text-slate-700">Rate schedule / custom pricing</span>
                    <textarea
                      className="mt-2 min-h-[200px] w-full rounded-lg border border-slate-300 px-3 py-3 text-sm leading-relaxed shadow-sm"
                      value={customNotes}
                      onChange={(e) => setCustomNotes(e.target.value)}
                      placeholder={`Pricing Schedule\n\n2 Bedroom / 3 Bathroom apartment turnover cleaning: GHS 1,250 per apartment per turnover\n\n1 Bedroom / 1 Bathroom apartment turnover cleaning: GHS 950 per apartment per turnover\n\n- Optional add-on example line\n\nHeavy reset or deep cleaning: priced after assessment`}
                    />
                  </label>
                  <p className="text-xs leading-relaxed text-slate-500">
                    Use one line per rate, e.g.{" "}
                    <span className="font-medium text-slate-700">
                      2 Bedroom / 3 Bathroom turnover cleaning: GHS 1,250 per apartment per turnover
                    </span>
                    . Blank lines add spacing. Lines starting with{" "}
                    <span className="font-mono text-[11px] text-slate-600">- </span> become bullets. Short titles without a colon
                    (like <span className="font-medium text-slate-700">Pricing Schedule</span>) render as a small heading.{" "}
                    <span className="font-medium text-slate-700">Label: value</span> rows get a clean two-column layout in the proposal
                    and PDF.
                  </p>
                </div>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard
            title="Media"
            subtitle="Uploads for inline visuals, galleries, and downloadable attachments."
          >
            <div className={contentLocked ? "pointer-events-none opacity-60" : ""}>
            <p className="mb-5 rounded-lg border border-slate-100 bg-slate-50/80 px-4 py-3 text-xs leading-relaxed text-slate-600">
              <span className="font-semibold text-slate-800">Inline / gallery</span> — appears in the document from Content blocks.{" "}
              <span className="font-semibold text-slate-800">Attachment</span> — listed under supporting documents. Mark{" "}
              <span className="font-semibold">Public</span> for client-visible files; <span className="font-semibold">Internal</span> stays
              staff-only.
            </p>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="block w-full max-w-lg cursor-pointer text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-800 hover:file:bg-slate-200"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ""
                if (f) void onUpload(f)
              }}
            />
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {assets.length === 0 ? (
                <p className="col-span-full rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-500">
                  No files yet. Upload an image or PDF.
                </p>
              ) : null}
              {assets.map((a) => (
                <div
                  key={a.id}
                  className="flex flex-col gap-4 rounded-xl border border-slate-200/90 bg-white p-5 shadow-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900" title={a.file_name}>
                      {a.file_name}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">{a.kind}</span>
                      <span className="truncate">{a.mime_type}</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-3 text-xs">
                    <label className="flex items-center gap-2 text-slate-700">
                      <input
                        type="checkbox"
                        checked={a.visible_on_public}
                        onChange={(e) => void patchAsset(a.id, { visible_on_public: e.target.checked })}
                      />
                      Client-visible (public page)
                    </label>
                    <label className="flex items-center gap-2 text-slate-700">
                      <input
                        type="checkbox"
                        checked={a.internal_only}
                        onChange={(e) => void patchAsset(a.id, { internal_only: e.target.checked })}
                      />
                      Internal only
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Placement</span>
                      <select
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                        value={a.role}
                        onChange={(e) => void patchAsset(a.id, { role: e.target.value })}
                      >
                        <option value="inline">Inline (in document)</option>
                        <option value="gallery">Gallery</option>
                        <option value="attachment">Attachment (download)</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="self-start text-xs font-medium text-slate-400 hover:text-red-700"
                      onClick={() => void deleteAsset(a.id)}
                    >
                      Remove file
                    </button>
                  </div>
                </div>
              ))}
            </div>
            </div>
          </SectionCard>

          <SectionCard title="Share" subtitle="Delivery uses the Send proposal menu in the header — email, WhatsApp, link, and public page.">
            <div className="flex flex-col gap-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
              <p className="min-w-0 leading-relaxed">
                <span className="font-medium text-slate-800">Send proposal</span> for email, WhatsApp, mark sent, copy link, or open the
                client page. Expand <span className="font-medium text-slate-800">Show client link</span> in that menu when you need the full
                URL.
              </p>
              <div className="shrink-0 text-xs text-slate-500">
                {emailHint ? <p className="text-amber-800">{emailHint}</p> : null}
                {phoneHint ? <p>{phoneHint}</p> : null}
              </div>
            </div>
          </SectionCard>
      </div>
    </div>
  )
}
