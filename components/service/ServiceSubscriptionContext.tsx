"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabaseClient"
import { getCurrentBusiness } from "@/lib/business"
import { useWorkspaceBusiness } from "@/components/WorkspaceBusinessContext"
import { shouldMountServiceSubscriptionProvider } from "@/lib/serviceWorkspace/serviceSubscriptionSurface"
import {
  type ServiceSubscriptionTier,
  type ServiceSubscriptionStatus,
  DEFAULT_SERVICE_SUBSCRIPTION_TIER,
} from "@/lib/serviceWorkspace/subscriptionTiers"
import {
  resolveServiceEntitlement,
  type ServiceEntitlement,
} from "@/lib/serviceWorkspace/resolveServiceEntitlement"
import { tierIncludes } from "@/lib/serviceWorkspace/subscriptionTiers"
import {
  resolveSubscriptionEntitlementScopeMode,
  SERVICE_SUBSCRIPTION_BUSINESS_COLUMNS,
  subscriptionEntitlementFromBusinessRow,
  workspaceBusinessSubscriptionKey,
} from "@/lib/serviceWorkspace/subscriptionEntitlementFromBusinessRow"

export type ServiceSubscriptionContextValue = {
  /** Effective tier — what the user actually has access to. */
  effectiveTier: ServiceSubscriptionTier
  /** Raw tier stored in DB (the plan they signed up for / are trialling). */
  tier: ServiceSubscriptionTier
  /** Full subscription status from the DB column. */
  status: ServiceSubscriptionStatus
  businessId: string | null
  loading: boolean
  /**
   * False until subscription fetch for the current business scope finishes.
   * Tier checks stay permissive until then (avoids Upgrade UI flashing on default starter).
   * Stays true during in-app navigations that do not change `business_id` (no flicker).
   */
  entitlementResolved: boolean

  /** True when effectiveTier satisfies the required tier. */
  canAccessTier: (required: ServiceSubscriptionTier) => boolean

  // --- Trial ---
  isTrialing: boolean
  trialExpired: boolean
  trialExpiredWithoutPayment: boolean
  trialGraceActive: boolean
  trialGraceExpired: boolean
  trialEndsAt: Date | null
  trialStartedAt: Date | null
  trialDaysLeft: number | null
  canWriteFinancialRecords: boolean

  // --- Billing period ---
  /** Billing cycle: 'monthly' | 'quarterly' | 'annual'. Null until loaded. */
  billingCycle: string | null
  /** When the current paid period ends. Null for trial users or when not set. */
  currentPeriodEndsAt: Date | null
  /** When the paid subscription began, if stored. */
  subscriptionStartedAt: Date | null
  /** True when the paid period has passed and renewal is needed. */
  periodExpired: boolean
  /** Days remaining until current_period_ends_at. Null when expired or not active. */
  daysUntilRenewal: number | null

  // --- Grace / lock ---
  inGracePeriod: boolean
  /** When the grace deadline expires (subscription_grace_until). Null if not set. */
  graceEndsAt: Date | null
  subscriptionLocked: boolean
  billingExempt: boolean
  billingExemptReason: string | null
}

const defaultValue: ServiceSubscriptionContextValue = {
  effectiveTier: DEFAULT_SERVICE_SUBSCRIPTION_TIER,
  tier: DEFAULT_SERVICE_SUBSCRIPTION_TIER,
  status: "active",
  businessId: null,
  loading: false,
  /** No Provider (non-service shell): skip TierGate loading state. */
  entitlementResolved: true,
  canAccessTier: () => true,
  isTrialing: false,
  trialExpired: false,
  trialExpiredWithoutPayment: false,
  trialGraceActive: false,
  trialGraceExpired: false,
  trialEndsAt: null,
  trialStartedAt: null,
  trialDaysLeft: null,
  canWriteFinancialRecords: true,
  billingCycle: null,
  currentPeriodEndsAt: null,
  subscriptionStartedAt: null,
  periodExpired: false,
  daysUntilRenewal: null,
  inGracePeriod: false,
  graceEndsAt: null,
  subscriptionLocked: false,
  billingExempt: false,
  billingExemptReason: null,
}

const ServiceSubscriptionContext =
  createContext<ServiceSubscriptionContextValue>(defaultValue)

export function ServiceSubscriptionProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const prevScopeRef = useRef<string | undefined>(undefined)
  const { business: ctxBusiness, sessionUser } = useWorkspaceBusiness()

  const shouldMount = shouldMountServiceSubscriptionProvider(pathname)

  const [entitlement, setEntitlement] = useState<ServiceEntitlement>(() =>
    resolveServiceEntitlement({})
  )
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [entitlementResolved, setEntitlementResolved] = useState(false)

  const urlBusinessId = searchParams.get("business_id")?.trim() || null
  const ctxBusinessId = ctxBusiness?.id ?? null
  const ctxSubscriptionKey = workspaceBusinessSubscriptionKey(
    ctxBusiness as Record<string, unknown> | null
  )

  const scopeMode = resolveSubscriptionEntitlementScopeMode(
    ctxBusinessId,
    urlBusinessId
  )

  useEffect(() => {
    if (!shouldMount) {
      prevScopeRef.current = undefined
      setEntitlementResolved(false)
      return
    }

    const scopeKey = urlBusinessId ?? ctxBusinessId ?? "__session__"
    const scopeChanged =
      prevScopeRef.current !== undefined && prevScopeRef.current !== scopeKey
    prevScopeRef.current = scopeKey

    let cancelled = false
    if (scopeChanged) {
      setEntitlementResolved(false)
    }

    ;(async () => {
      setLoading(true)
      try {
        if (scopeMode === "context" && ctxBusiness?.id) {
          if (cancelled) return
          setBusinessId(ctxBusiness.id)
          setEntitlement(
            subscriptionEntitlementFromBusinessRow(
              ctxBusiness as Record<string, unknown>
            )
          )
          return
        }

        if (scopeMode === "url_query" && urlBusinessId) {
          const { data } = await supabase
            .from("businesses")
            .select(SERVICE_SUBSCRIPTION_BUSINESS_COLUMNS)
            .eq("id", urlBusinessId)
            .is("archived_at", null)
            .maybeSingle()
          if (cancelled) return
          setBusinessId((data as { id?: string } | null)?.id ?? urlBusinessId)
          setEntitlement(
            subscriptionEntitlementFromBusinessRow(
              data as Record<string, unknown> | null
            )
          )
          return
        }

        let userId = sessionUser?.id ?? null
        if (!userId) {
          const {
            data: { user },
          } = await supabase.auth.getUser()
          userId = user?.id ?? null
        }

        if (!userId || cancelled) {
          if (!cancelled) {
            setBusinessId(null)
            setEntitlement(resolveServiceEntitlement({}))
          }
          return
        }

        const b = await getCurrentBusiness(supabase, userId)
        if (cancelled) return
        setBusinessId((b as { id?: string } | null)?.id ?? null)
        setEntitlement(
          subscriptionEntitlementFromBusinessRow(
            b as Record<string, unknown> | null
          )
        )
      } finally {
        if (!cancelled) {
          setEntitlementResolved(true)
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    shouldMount,
    urlBusinessId,
    ctxBusinessId,
    ctxSubscriptionKey,
    scopeMode,
    sessionUser?.id,
  ])

  const canAccessTier = useCallback(
    (required: ServiceSubscriptionTier) => {
      if (!entitlementResolved) return true
      return tierIncludes(entitlement.effectiveTier, required)
    },
    [entitlement.effectiveTier, entitlementResolved]
  )

  const value = useMemo<ServiceSubscriptionContextValue>(
    () => ({
      effectiveTier: entitlement.effectiveTier,
      tier: entitlement.rawTier,
      status: entitlement.status,
      businessId,
      loading,
      entitlementResolved,
      canAccessTier,
      isTrialing: entitlement.isTrialing,
      trialExpired: entitlement.trialExpired,
      trialExpiredWithoutPayment: entitlement.trialExpiredWithoutPayment,
      trialGraceActive: entitlement.trialGraceActive,
      trialGraceExpired: entitlement.trialGraceExpired,
      trialEndsAt: entitlement.trialEndsAt,
      trialStartedAt: entitlement.trialStartedAt,
      trialDaysLeft: entitlement.trialDaysLeft,
      canWriteFinancialRecords: entitlement.canWriteFinancialRecords,
      billingCycle: entitlement.billingCycle,
      currentPeriodEndsAt: entitlement.currentPeriodEndsAt,
      subscriptionStartedAt: entitlement.subscriptionStartedAt,
      periodExpired: entitlement.periodExpired,
      daysUntilRenewal: entitlement.daysUntilRenewal,
      inGracePeriod: entitlement.inGracePeriod,
      graceEndsAt: entitlement.graceEndsAt,
      subscriptionLocked: entitlement.isSubscriptionLocked,
      billingExempt: entitlement.billingExempt,
      billingExemptReason: entitlement.billingExemptReason,
    }),
    [entitlement, businessId, loading, entitlementResolved, canAccessTier]
  )

  if (!shouldMount) return <>{children}</>

  return (
    <ServiceSubscriptionContext.Provider value={value}>
      {children}
    </ServiceSubscriptionContext.Provider>
  )
}

export function useServiceSubscription(): ServiceSubscriptionContextValue {
  return useContext(ServiceSubscriptionContext)
}
