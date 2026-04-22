import type { SupabaseClient } from "@supabase/supabase-js"
import { normalizeProposalForRender, type ProposalRenderBusiness, type ProposalRenderCustomer } from "./renderModel"
import { parseProposalSections } from "./schema"
import { pricingPayloadForRender } from "./pricingForDb"
import { signProposalAssetPaths } from "./signing"

export type ProposalRow = {
  id: string
  business_id: string
  customer_id: string | null
  title: string
  proposal_number: string | null
  status: string
  template_id: string
  sections: unknown
  pricing_mode: string
  pricing_payload: unknown
  currency_code: string | null
  public_token: string | null
}

export type ProposalAssetRow = {
  id: string
  kind: string
  mime_type: string
  file_name: string
  role: string
  visible_on_public: boolean
  internal_only: boolean
  sort_order: number
  storage_path: string
}

export async function assembleProposalRenderModel(
  supabase: SupabaseClient,
  input: {
    proposal: ProposalRow
    business: ProposalRenderBusiness
    customer: ProposalRenderCustomer | null
    assets: ProposalAssetRow[]
    publicView: boolean
    signTtlSec: number
    includePublicToken?: boolean
    /**
     * When set (typically public proposal JSON), asset URLs are same-origin `/api/proposals/public/.../assets/:id`
     * so images and PDFs load reliably in the browser without cross-origin signed URLs.
     */
    publicAssetUrlForId?: (assetId: string) => string
  }
) {
  const signRows = input.assets
    .filter((a) => {
      if (input.publicView && (a.internal_only || !a.visible_on_public)) return false
      return true
    })
    .map((a) => ({ id: a.id, storage_path: a.storage_path }))

  const publicAssetUrlForId = input.publicAssetUrlForId
  const assetUrlById: Record<string, string> = publicAssetUrlForId
    ? Object.fromEntries(signRows.map((r) => [r.id, publicAssetUrlForId(r.id)]))
    : await signProposalAssetPaths(supabase, signRows, input.signTtlSec)

  const sections = parseProposalSections(input.proposal.sections)
  const pricing = pricingPayloadForRender(input.proposal.pricing_mode, input.proposal.pricing_payload)

  const model = normalizeProposalForRender({
    title: input.proposal.title || "Proposal",
    proposal_number: input.proposal.proposal_number,
    status: input.proposal.status,
    template_id: input.proposal.template_id,
    currency_code: input.proposal.currency_code,
    business: input.business,
    customer: input.customer,
    sections,
    pricing,
    assets: input.assets.map((a) => ({
      id: a.id,
      kind: a.kind,
      mime_type: a.mime_type,
      file_name: a.file_name,
      role: a.role,
      visible_on_public: a.visible_on_public,
      internal_only: a.internal_only,
      sort_order: a.sort_order,
    })),
    assetUrlById,
    publicView: input.publicView,
    public_token: input.includePublicToken ? input.proposal.public_token : undefined,
  })

  return { model, assetUrlById }
}
