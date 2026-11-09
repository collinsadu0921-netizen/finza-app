import type { SupabaseClient } from "@supabase/supabase-js"
import { parseProposalSections, pricingModeSchema, type PricingMode } from "@/lib/proposals/schema"
import { pricingPayloadForRender } from "@/lib/proposals/pricingForDb"
import { normalizeProposalStatus, type ProposalStatus } from "@/lib/proposals/proposalState"

export type ProposalAiBusinessContext = {
  id: string
  name: string
  legalName: string | null
  tradingName: string | null
  logoUrl: string | null
  address: string | null
  phone: string | null
  email: string | null
  website: string | null
  tin: string | null
  defaultCurrency: string | null
  industry: string | null
}

export type ProposalAiCustomerContext = {
  id: string
  name: string
  email: string | null
  phone: string | null
}

export type ProposalAiServiceContext = {
  name: string
  unitPrice: number | null
  source: "service_catalog" | "products_services"
}

export type ProposalAiProposalContext = {
  id: string
  title: string
  status: ProposalStatus
  customerId: string | null
  templateId: string
  currencyCode: string | null
  expiresAt: string | null
  sections: ReturnType<typeof parseProposalSections>
  pricingMode: PricingMode
  pricingPayload: ReturnType<typeof pricingPayloadForRender>
}

export type ProposalAiContext = {
  business: ProposalAiBusinessContext
  proposal: ProposalAiProposalContext
  selectedCustomer: ProposalAiCustomerContext | null
  customers: ProposalAiCustomerContext[]
  services: ProposalAiServiceContext[]
}

export type LoadProposalAiContextResult =
  | { ok: true; context: ProposalAiContext }
  | { ok: false; status: number; error: string }

function trimmed(value: unknown): string | null {
  if (typeof value !== "string") return null
  const text = value.trim()
  return text || null
}

function businessAddress(row: Record<string, unknown>): string | null {
  const parts = [row.address_street, row.address_city, row.address_region, row.address_country]
    .map(trimmed)
    .filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(", ") : null
}

/**
 * Loads only the authenticated business's proposal context. The proposal is
 * always resolved by both id and business_id; customer/service lists are
 * scoped to the same business.
 */
export async function loadProposalAiContext(
  supabase: SupabaseClient,
  args: { businessId: string; proposalId: string }
): Promise<LoadProposalAiContextResult> {
  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", args.businessId)
    .is("archived_at", null)
    .maybeSingle()

  if (businessError || !business) {
    return { ok: false, status: 404, error: "Business not found" }
  }

  const { data: proposal, error: proposalError } = await supabase
    .from("proposals")
    .select(
      "id, business_id, customer_id, title, status, template_id, pricing_mode, pricing_payload, currency_code, expires_at, sections, deleted_at"
    )
    .eq("id", args.proposalId)
    .eq("business_id", args.businessId)
    .is("deleted_at", null)
    .maybeSingle()

  if (proposalError || !proposal) {
    return { ok: false, status: 404, error: "Proposal not found" }
  }

  const { data: customerRows } = await supabase
    .from("customers")
    .select("id, name, email, phone, whatsapp_phone")
    .eq("business_id", args.businessId)
    .order("name", { ascending: true })
    .limit(100)

  const customers: ProposalAiCustomerContext[] = (customerRows ?? [])
    .map((row) => {
      const record = row as Record<string, unknown>
      const id = trimmed(record.id)
      const name = trimmed(record.name)
      if (!id || !name) return null
      return {
        id,
        name,
        email: trimmed(record.email),
        phone: trimmed(record.whatsapp_phone) || trimmed(record.phone),
      }
    })
    .filter((row): row is ProposalAiCustomerContext => row !== null)

  const customerId = trimmed(proposal.customer_id)
  const selectedCustomer = customerId
    ? customers.find((customer) => customer.id === customerId) ?? null
    : null

  const { data: productRows } = await supabase
    .from("products_services")
    .select("id, name, unit_price")
    .eq("business_id", args.businessId)
    .is("deleted_at", null)
    .order("name", { ascending: true })
    .limit(100)

  const services: ProposalAiServiceContext[] = []
  const seenServices = new Set<string>()
  for (const row of productRows ?? []) {
    const record = row as Record<string, unknown>
    const name = trimmed(record.name)
    if (!name) continue
    const key = name.toLowerCase()
    if (seenServices.has(key)) continue
    seenServices.add(key)
    const price = Number(record.unit_price)
    services.push({
      name,
      unitPrice: Number.isFinite(price) ? price : null,
      source: "products_services",
    })
  }

  const industry = String((business as Record<string, unknown>).industry ?? "").toLowerCase()
  if (industry === "service") {
    const { data: catalogRows } = await supabase
      .from("service_catalog")
      .select("id, name, default_price")
      .eq("business_id", args.businessId)
      .eq("is_active", true)
      .order("name", { ascending: true })
      .limit(100)
    for (const row of catalogRows ?? []) {
      const record = row as Record<string, unknown>
      const name = trimmed(record.name)
      if (!name) continue
      const key = name.toLowerCase()
      if (seenServices.has(key)) continue
      seenServices.add(key)
      const price = Number(record.default_price)
      services.push({
        name,
        unitPrice: Number.isFinite(price) ? price : null,
        source: "service_catalog",
      })
    }
  }

  const businessRow = business as Record<string, unknown>
  const proposalCurrency = trimmed(proposal.currency_code) || trimmed(businessRow.default_currency)
  const rawPricingMode = String(proposal.pricing_mode ?? "none")
  const pricingMode = pricingModeSchema.safeParse(rawPricingMode).success
    ? (rawPricingMode as PricingMode)
    : "none"

  return {
    ok: true,
    context: {
      business: {
        id: String(businessRow.id),
        name: String(businessRow.name ?? ""),
        legalName: trimmed(businessRow.legal_name),
        tradingName: trimmed(businessRow.trading_name),
        logoUrl: trimmed(businessRow.logo_url),
        address: businessAddress(businessRow),
        phone: trimmed(businessRow.phone),
        email: trimmed(businessRow.email),
        website: trimmed(businessRow.website),
        tin: trimmed(businessRow.tin),
        defaultCurrency: trimmed(businessRow.default_currency),
        industry: trimmed(businessRow.industry),
      },
      proposal: {
        id: String(proposal.id),
        title: String(proposal.title ?? "Proposal"),
        status: normalizeProposalStatus(String(proposal.status ?? "draft")),
        customerId,
        templateId: String(proposal.template_id ?? "premium_v1"),
        currencyCode: proposalCurrency,
        expiresAt: trimmed(proposal.expires_at),
        sections: parseProposalSections(proposal.sections),
        pricingMode,
        pricingPayload: pricingPayloadForRender(
          pricingMode,
          proposal.pricing_payload
        ),
      },
      selectedCustomer,
      customers,
      services: services.slice(0, 100),
    },
  }
}

/** Reduce context to the minimum needed by the model and avoid unnecessary PII. */
export function compactProposalAiContext(context: ProposalAiContext, snapshot?: unknown) {
  return {
    business: context.business,
    proposal: {
      ...context.proposal,
      sections: undefined,
      pricingPayload: undefined,
    },
    selectedCustomer: context.selectedCustomer,
    existingCustomers: context.customers.map((customer) => ({
      id: customer.id,
      name: customer.name,
    })),
    services: context.services,
    currentDraft: snapshot ?? {
      title: context.proposal.title,
      customer_id: context.proposal.customerId,
      template_id: context.proposal.templateId,
      currency_code: context.proposal.currencyCode,
      sections: context.proposal.sections,
      pricing_mode: context.proposal.pricingMode,
      pricing_payload: context.proposal.pricingPayload,
    },
  }
}
