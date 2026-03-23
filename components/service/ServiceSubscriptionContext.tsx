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
  parseServiceSubscriptionTier,
  tierIncludes,
  DEFAULT_SERVICE_SUBSCRIPTION_TIER,
} from "@/lib/serviceWorkspace/subscriptionTiers"

export type ServiceSubscriptionContextValue = {
  tier: ServiceSubscriptionTier
  businessId: string | null
  loading: boolean
  /** Whether current workspace tier satisfies a minimum tier requirement. */
  canAccessTier: (required: ServiceSubscriptionTier) => boolean
  /**
   * True when a MoMo payment has failed but the 3-day grace period has not
   * yet expired (subscription_grace_until is set and in the future).
   * Features remain accessible but a warning banner is shown.
   */
  inGracePeriod: boolean
  /**
   * True when a MoMo payment failed AND the 3-day grace period has expired
   * (subscription_grace_until is set and in the past).
   * Tier-gated features are blocked until payment is resolved.
   */
  subscriptionLocked: boolean
}

const defaultValue: ServiceSubscriptionContextValue = {
  tier: DEFAULT_SERVICE_SUBSCRIPTION_TIER,
  businessId: null,
  loading: false,
  canAccessTier: () => true,
  inGracePeriod: false,
  subscriptionLocked: false,
}

const ServiceSubscriptionContext = createContext<ServiceSubscriptionContextValue>(defaultValue)

export function ServiceSubscriptionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  // Activate for /service/* paths AND the legacy root-level routes that are
  // service-workspace features but haven't been moved under /service/ yet.
  // This ensures TierGate works even if a user navigates to those paths directly.
  const isService =
    (pathname?.startsWith("/service") ?? false) ||
    (pathname?.startsWith("/bills") ?? false) ||
    (pathname?.startsWith("/payroll") ?? false) ||
    (pathname?.startsWith("/assets") ?? false) ||
    (pathname?.startsWith("/credit-notes") ?? false) ||
    (pathname?.startsWith("/audit-log") ?? false) ||
    (pathname?.startsWith("/vat-returns") ?? false)

  const [tier, setTier] = useState<ServiceSubscriptionTier>(DEFAULT_SERVICE_SUBSCRIPTION_TIER)
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [graceUntil, setGraceUntil] = useState<Date | null>(null)

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
            .select("id, service_subscription_tier, subscription_grace_until")
            .eq("id", urlBusinessId)
            .is("archived_at", null)
            .maybeSingle()
          if (cancelled) return
          const row = data as { id?: string; service_subscription_tier?: string; subscription_grace_until?: string | null } | null
          setBusinessId(row?.id ?? urlBusinessId)
          setTier(parseServiceSubscriptionTier(row?.service_subscription_tier))
          setGraceUntil(row?.subscription_grace_until ? new Date(row.subscription_grace_until) : null)
          return
        }

        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user || cancelled) {
          if (!cancelled) {
            setBusinessId(null)
            setTier(DEFAULT_SERVICE_SUBSCRIPTION_TIER)
            setGraceUntil(null)
          }
          return
        }

        const b = await getCurrentBusiness(supabase, user.id)
        if (cancelled) return
        const biz = b as { id?: string; service_subscription_tier?: string; subscription_grace_until?: string | null } | null
        setBusinessId(biz?.id ?? null)
        setTier(parseServiceSubscriptionTier(biz?.service_subscription_tier))
        setGraceUntil(biz?.subscription_grace_until ? new Date(biz.subscription_grace_until) : null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isService, urlBusinessId, pathname])

  const canAccessTier = useCallback(
    (required: ServiceSubscriptionTier) => tierIncludes(tier, required),
    [tier]
  )

  const now = new Date()
  const inGracePeriod  = graceUntil !== null && now < graceUntil
  const subscriptionLocked = graceUntil !== null && now >= graceUntil

  const value = useMemo<ServiceSubscriptionContextValue>(
    () => ({
      tier,
      businessId,
      loading,
      canAccessTier,
      inGracePeriod,
      subscriptionLocked,
    }),
    [tier, businessId, loading, canAccessTier, inGracePeriod, subscriptionLocked]
  )

  if (!isService) {
    return <>{children}</>
  }

  return (
    <ServiceSubscriptionContext.Provider value={value}>{children}</ServiceSubscriptionContext.Provider>
  )
}

export function useServiceSubscription(): ServiceSubscriptionContextValue {
  return useContext(ServiceSubscriptionContext)
}
