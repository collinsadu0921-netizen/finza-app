import type { PricingPayload } from "./schema"
import type { ProposalSectionBlock } from "./schema"
import {
  defaultTypographyForTemplate,
  normalizeAccentColor,
  normalizeTypography,
  type ProposalTypography,
} from "./design"
import { normalizeTemplateId, type ProposalTemplateId } from "./templates"

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
  | { type: "heading"; level: number; text: string; id?: string; hidden?: boolean; guidance?: boolean }
  | { type: "paragraph"; text: string; id?: string; hidden?: boolean; guidance?: boolean }
  | { type: "bullet_list"; items: string[]; id?: string; hidden?: boolean; guidance?: boolean }
  | { type: "image"; src: string; caption?: string; assetId: string; width?: number; height?: number; id?: string; hidden?: boolean; guidance?: boolean }
  | { type: "gallery"; images: { src: string; assetId: string; width?: number; height?: number }[]; caption?: string; id?: string; hidden?: boolean; guidance?: boolean }
  | { type: "divider"; id?: string; hidden?: boolean; guidance?: boolean }

export type ProposalRenderAttachment = {
  id: string
  file_name: string
  mime_type: string
  kind: string
  /** HTTPS URL (signed) for download / new tab */
  url: string
}

export type ProposalPresentation = {
  templateId: ProposalTemplateId
  accentColor: string | null
  typography: ProposalTypography
  coverAssetId: string | null
  coverImageUrl: string | null
}

export type ProposalRenderModel = {
  title: string
  proposal_number: string | null
  status: string
  template_id: string
  presentation: ProposalPresentation
  /** Resolved for display (proposal override or business default). */
  currency_code: string
  business: ProposalRenderBusiness
  customer: ProposalRenderCustomer | null
  sections: ProposalRenderSection[]
  pricing: PricingPayload
  attachments: ProposalRenderAttachment[]
  created_at: string | null
  expires_at: string | null
  accepted_at?: string | null
  rejected_at?: string | null
  rejected_reason?: string | null
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
    metadata?: { width?: number; height?: number } | null
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
  brand_accent_color?: string | null
  cover_asset_id?: string | null
  typography?: string | null
  currency_code?: string | null
  business: ProposalRenderBusiness
  customer: ProposalRenderCustomer | null
  sections: ProposalSectionBlock[]
  pricing: PricingPayload
  created_at?: string | null
  expires_at?: string | null
  accepted_at?: string | null
  rejected_at?: string | null
  rejected_reason?: string | null
  assets: Array<{
    id: string
    kind: string
    mime_type: string
    file_name: string
    role: string
    visible_on_public: boolean
    internal_only: boolean
    sort_order: number
    metadata?: { width?: number; height?: number } | null
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

  const resolveAsset = (
    assetId: string
  ): { src: string; width?: number; height?: number } | null => {
    const row = assetMap.get(assetId)
    if (!row) return null
    if (input.publicView) {
      if (row.internal_only || !row.visible_on_public) return null
    }
    const src = input.assetUrlById[assetId]
    if (!src) return null
    const width = Number(row.metadata?.width)
    const height = Number(row.metadata?.height)
    return {
      src,
      width: Number.isFinite(width) && width > 0 ? width : undefined,
      height: Number.isFinite(height) && height > 0 ? height : undefined,
    }
  }
  const resolveUrl = (assetId: string): string | null => resolveAsset(assetId)?.src ?? null

  const sections: ProposalRenderSection[] = []
  for (const b of input.sections) {
    switch (b.type) {
      case "heading":
        sections.push({ type: "heading", level: b.level, text: b.text, id: blockId(b), hidden: b.hidden, guidance: b.guidance })
        break
      case "paragraph":
        sections.push({ type: "paragraph", text: b.text, id: blockId(b), hidden: b.hidden, guidance: b.guidance })
        break
      case "bullet_list":
        sections.push({ type: "bullet_list", items: b.items, id: blockId(b), hidden: b.hidden, guidance: b.guidance })
        break
      case "divider":
        sections.push({ type: "divider", id: blockId(b), hidden: b.hidden, guidance: b.guidance })
        break
      case "image": {
        const asset = resolveAsset(b.asset_id)
        if (asset) {
          sections.push({
            type: "image",
            src: asset.src,
            width: asset.width,
            height: asset.height,
            caption: b.caption,
            assetId: b.asset_id,
            id: blockId(b),
            hidden: b.hidden,
            guidance: b.guidance,
          })
        }
        break
      }
      case "gallery": {
        const images: { src: string; assetId: string; width?: number; height?: number }[] = []
        for (const aid of b.asset_ids) {
          const asset = resolveAsset(aid)
          if (asset) images.push({ ...asset, assetId: aid })
        }
        if (images.length > 0) {
          sections.push({ type: "gallery", images, caption: b.caption, id: blockId(b), hidden: b.hidden, guidance: b.guidance })
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

  const templateId = normalizeTemplateId(input.template_id)
  const coverAssetId = input.cover_asset_id?.trim() || null
  const coverImageUrl = coverAssetId ? resolveUrl(coverAssetId) : null

  return {
    title: input.title,
    proposal_number: input.proposal_number ?? null,
    status: input.status,
    template_id: templateId,
    presentation: {
      templateId,
      accentColor: input.brand_accent_color
        ? normalizeAccentColor(input.brand_accent_color, "")
        : null,
      typography: input.typography
        ? normalizeTypography(input.typography)
        : defaultTypographyForTemplate(templateId),
      coverAssetId,
      coverImageUrl,
    },
    currency_code: resolveProposalDisplayCurrency(input.currency_code, input.business),
    business: input.business,
    customer: input.customer,
    sections,
    pricing: input.pricing,
    attachments,
    created_at: input.created_at ?? null,
    expires_at: input.expires_at ?? null,
    accepted_at: input.accepted_at ?? null,
    rejected_at: input.rejected_at ?? null,
    rejected_reason: input.rejected_reason ?? null,
    public_token: input.public_token,
  }
}
