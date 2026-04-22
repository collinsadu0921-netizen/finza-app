import type { PricingPayload } from "./schema"
import type { ProposalSectionBlock } from "./schema"

export type ProposalRenderBusiness = {
  name: string
  legal_name?: string | null
  trading_name?: string | null
  logo_url?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  /** Used when proposal.currency_code is null (business default) so money formatting works in views/PDF */
  default_currency?: string | null
}

export type ProposalRenderCustomer = {
  name: string
  email?: string | null
  phone?: string | null
}

export type ProposalRenderSection =
  | { type: "heading"; level: number; text: string; id?: string }
  | { type: "paragraph"; text: string; id?: string }
  | { type: "bullet_list"; items: string[]; id?: string }
  | { type: "image"; src: string; caption?: string; assetId: string; id?: string }
  | { type: "gallery"; images: { src: string; assetId: string }[]; caption?: string; id?: string }
  | { type: "divider"; id?: string }

export type ProposalRenderAttachment = {
  id: string
  file_name: string
  mime_type: string
  kind: string
  /** HTTPS URL (signed) for download / new tab */
  url: string
}

export type ProposalRenderModel = {
  title: string
  proposal_number: string | null
  status: string
  template_id: string
  /** Resolved for display (proposal override or business default). */
  currency_code: string
  business: ProposalRenderBusiness
  customer: ProposalRenderCustomer | null
  sections: ProposalRenderSection[]
  pricing: PricingPayload
  attachments: ProposalRenderAttachment[]
  /** Proposal public token — for “copy link” in staff preview only */
  public_token?: string | null
}

type AssetMap = Map<
  string,
  {
    id: string
    kind: string
    mime_type: string
    file_name: string
    role: string
    visible_on_public: boolean
    internal_only: boolean
    sort_order: number
  }
>

function blockId(b: ProposalSectionBlock): string | undefined {
  return "id" in b && typeof b.id === "string" ? b.id : undefined
}

/** ISO code for display: explicit proposal override, else business default, else GHS. */
function resolveProposalDisplayCurrency(
  proposalCurrency: string | null | undefined,
  business: ProposalRenderBusiness
): string {
  const row = proposalCurrency?.trim()
  if (row) return row.toUpperCase()
  const def = business.default_currency?.trim()
  if (def) return def.toUpperCase()
  return "GHS"
}

export function normalizeProposalForRender(input: {
  title: string
  proposal_number?: string | null
  status: string
  template_id: string
  currency_code?: string | null
  business: ProposalRenderBusiness
  customer: ProposalRenderCustomer | null
  sections: ProposalSectionBlock[]
  pricing: PricingPayload
  assets: Array<{
    id: string
    kind: string
    mime_type: string
    file_name: string
    role: string
    visible_on_public: boolean
    internal_only: boolean
    sort_order: number
  }>
  assetUrlById: Record<string, string>
  /** When true, omit internal_only assets and non–public-visible media for inline */
  publicView: boolean
  public_token?: string | null
}): ProposalRenderModel {
  const m = new Map<string, (typeof input.assets)[0]>()
  for (const a of input.assets) {
    m.set(a.id, a)
  }
  const assetMap: AssetMap = m

  const resolveUrl = (assetId: string): string | null => {
    const row = assetMap.get(assetId)
    if (!row) return null
    if (input.publicView) {
      if (row.internal_only || !row.visible_on_public) return null
    }
    return input.assetUrlById[assetId] || null
  }

  const sections: ProposalRenderSection[] = []
  for (const b of input.sections) {
    switch (b.type) {
      case "heading":
        sections.push({ type: "heading", level: b.level, text: b.text, id: blockId(b) })
        break
      case "paragraph":
        sections.push({ type: "paragraph", text: b.text, id: blockId(b) })
        break
      case "bullet_list":
        sections.push({ type: "bullet_list", items: b.items, id: blockId(b) })
        break
      case "divider":
        sections.push({ type: "divider", id: blockId(b) })
        break
      case "image": {
        const src = resolveUrl(b.asset_id)
        if (src) {
          sections.push({
            type: "image",
            src,
            caption: b.caption,
            assetId: b.asset_id,
            id: blockId(b),
          })
        }
        break
      }
      case "gallery": {
        const images: { src: string; assetId: string }[] = []
        for (const aid of b.asset_ids) {
          const src = resolveUrl(aid)
          if (src) images.push({ src, assetId: aid })
        }
        if (images.length > 0) {
          sections.push({ type: "gallery", images, caption: b.caption, id: blockId(b) })
        }
        break
      }
      default:
        break
    }
  }

  const attachments: ProposalRenderAttachment[] = []
  const sortedAssets = [...input.assets].sort((a, b) => a.sort_order - b.sort_order || a.file_name.localeCompare(b.file_name))
  for (const a of sortedAssets) {
    if (input.publicView && (a.internal_only || !a.visible_on_public)) continue
    const isPdf = a.kind === "pdf" || a.mime_type === "application/pdf"
    const isAttachmentRole = a.role === "attachment" || isPdf
    if (!isAttachmentRole) continue
    const url = input.assetUrlById[a.id]
    if (!url) continue
    attachments.push({
      id: a.id,
      file_name: a.file_name,
      mime_type: a.mime_type,
      kind: a.kind,
      url,
    })
  }

  return {
    title: input.title,
    proposal_number: input.proposal_number ?? null,
    status: input.status,
    template_id: input.template_id,
    currency_code: resolveProposalDisplayCurrency(input.currency_code, input.business),
    business: input.business,
    customer: input.customer,
    sections,
    pricing: input.pricing,
    attachments,
    public_token: input.public_token,
  }
}
