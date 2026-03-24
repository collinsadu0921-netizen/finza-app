"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import {
  type ServiceSubscriptionTier,
  type ServiceSubscriptionStatus,
  DEFAULT_SERVICE_SUBSCRIPTION_TIER,
} from "@/lib/serviceWorkspace/subscriptionTiers"
import {
  resolveServiceEntitlement,
  type RawBusinessSubscriptionRow,
  type ServiceEntitlement,
} from "@/lib/serviceWorkspace/resolveServiceEntitlement"
import { tierIncludes } from "@/lib/serviceWorkspace/subscriptionTiers"

export type ServiceSubscriptionContextValue = {
  /** Effective tier — what the user actually has access to. */
  effectiveTier: ServiceSubscriptionTier
  /** Raw tier stored in DB (the plan they signed up for / are trialling). */
  tier: ServiceSubscriptionTier
  /** Full subscription status from the DB column. */
  status: ServiceSubscriptionStatus
  businessId: string | null
  loading: boolean

  /** True when effectiveTier satisfies the required tier. */
  canAccessTier: (required: ServiceSubscriptionTier) => boolean

  // --- Trial ---
  isTrialing: boolean
  trialExpired: boolean
  trialEndsAt: Date | null
  trialDaysLeft: number | null

  // --- Billing period ---
  /** Billing cycle: 'monthly' | 'quarterly' | 'annual'. Null until loaded. */
  billingCycle: string | null
  /** When the current paid period ends. Null for trial users or when not set. */
  currentPeriodEndsAt: Date | null
  /** True when the paid period has passed and renewal is needed. */
  periodExpired: boolean
  /** Days remaining until current_period_ends_at. Null when expired or not active. */
  daysUntilRenewal: number | null

  // --- Grace / lock ---
  inGracePeriod: boolean
  /** When the grace deadline expires (subscription_grace_until). Null if not set. */
  graceEndsAt: Date | null
  subscriptionLocked: boolean
}

const defaultValue: ServiceSubscriptionContextValue = {
  effectiveTier: DEFAULT_SERVICE_SUBSCRIPTION_TIER,
  tier: DEFAULT_SERVICE_SUBSCRIPTION_TIER,
  status: "active",
  businessId: null,
  loading: false,
  canAccessTier: () => true,
  isTrialing: false,
  trialExpired: false,
  trialEndsAt: null,
  trialDaysLeft: null,
  billingCycle: null,
  currentPeriodEndsAt: null,
  periodExpired: false,
  daysUntilRenewal: null,
  inGracePeriod: false,
  graceEndsAt: null,
  subscriptionLocked: false,
}

const ServiceSubscriptionContext =
  createContext<ServiceSubscriptionContextValue>(defaultValue)

const SERVICE_COLUMNS =
  "id, service_subscription_tier, service_subscription_status, subscription_grace_until, trial_started_at, trial_ends_at, current_period_ends_at, billing_cycle"

function rowToEntitlement(row: Record<string, unknown> | null): ServiceEntitlement {
  const r: RawBusinessSubscriptionRow = {
    service_subscription_tier:   (row?.service_subscription_tier   as string) ?? null,
    service_subscription_status: (row?.service_subscription_status as string) ?? null,
    trial_started_at:            (row?.trial_started_at            as string) ?? null,
    trial_ends_at:               (row?.trial_ends_at               as string) ?? null,
    subscription_grace_until:    (row?.subscription_grace_until    as string) ?? null,
    current_period_ends_at:      (row?.current_period_ends_at      as string) ?? null,
    billing_cycle:               (row?.billing_cycle               as string) ?? null,
  }
  return resolveServiceEntitlement(r)
}

export function ServiceSubscriptionProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname     = usePathname()
  const searchParams = useSearchParams()

  // Activate for /service/* paths AND legacy root-level service routes.
  const isService =
    (pathname?.startsWith("/service") ?? false) ||
    (pathname?.startsWith("/bills")        ?? false) ||
    (pathname?.startsWith("/payroll")      ?? false) ||
    (pathname?.startsWith("/assets")       ?? false) ||
    (pathname?.startsWith("/credit-notes") ?? false) ||
    (pathname?.startsWith("/audit-log")    ?? false) ||
    (pathname?.startsWith("/vat-returns")  ?? false)

  const [entitlement, setEntitlement] = useState<ServiceEntitlement>(() =>
    resolveServiceEntitlement({})
  )
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [loading, setLoading]       = useState(false)

  const urlBusinessId = searchParams.get("business_id")?.trim() || null

  useEffect(() => {
    if (!isService) return

    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        if (urlBusinessId) {
          const { data } = await supabase
            .from("businesses")
            .select(SERVICE_COLUMNS)
            .eq("id", urlBusinessId)
            .is("archived_at", null)
            .maybeSingle()
          if (cancelled) return
          setBusinessId((data as any)?.id ?? urlBusinessId)
          setEntitlement(rowToEntitlement(data as Record<string, unknown> | null))
          return
        }

        const { data: { user } } = await supabase.auth.getUser()
        if (!user || cancelled) {
          if (!cancelled) {
            setBusinessId(null)
            setEntitlement(resolveServiceEntitlement({}))
          }
          return
        }

        const b = await getCurrentBusiness(supabase, user.id)
        if (cancelled) return
        setBusinessId((b as any)?.id ?? null)
        setEntitlement(rowToEntitlement(b as Record<string, unknown> | null))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [isService, urlBusinessId, pathname])

  const canAccessTier = useCallback(
    (required: ServiceSubscriptionTier) =>
      tierIncludes(entitlement.effectiveTier, required),
    [entitlement.effectiveTier]
  )

  const value = useMemo<ServiceSubscriptionContextValue>(
    () => ({
      effectiveTier:      entitlement.effectiveTier,
      tier:               entitlement.rawTier,
      status:             entitlement.status,
      businessId,
      loading,
      canAccessTier,
      isTrialing:         entitlement.isTrialing,
      trialExpired:       entitlement.trialExpired,
      trialEndsAt:        entitlement.trialEndsAt,
      trialDaysLeft:      entitlement.trialDaysLeft,
      billingCycle:       entitlement.billingCycle,
      currentPeriodEndsAt: entitlement.currentPeriodEndsAt,
      periodExpired:      entitlement.periodExpired,
      daysUntilRenewal:   entitlement.daysUntilRenewal,
      inGracePeriod:      entitlement.inGracePeriod,
      graceEndsAt:        entitlement.graceEndsAt,
      subscriptionLocked: entitlement.isSubscriptionLocked,
    }),
    [entitlement, businessId, loading, canAccessTier]
  )

  if (!isService) return <>{children}</>

  return (
    <ServiceSubscriptionContext.Provider value={value}>
      {children}
    </ServiceSubscriptionContext.Provider>
  )
}

export function useServiceSubscription(): ServiceSubscriptionContextValue {
  return useContext(ServiceSubscriptionContext)
}
