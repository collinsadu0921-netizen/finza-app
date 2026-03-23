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
}

const defaultValue: ServiceSubscriptionContextValue = {
  tier: DEFAULT_SERVICE_SUBSCRIPTION_TIER,
  businessId: null,
  loading: false,
  canAccessTier: () => true,
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
    (pathname?.startsWith("/audit-log") ?? false)

  const [tier, setTier] = useState<ServiceSubscriptionTier>(DEFAULT_SERVICE_SUBSCRIPTION_TIER)
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

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
            .select("id, service_subscription_tier")
            .eq("id", urlBusinessId)
            .is("archived_at", null)
            .maybeSingle()
          if (cancelled) return
          setBusinessId(data?.id ?? urlBusinessId)
          setTier(parseServiceSubscriptionTier((data as { service_subscription_tier?: string } | null)?.service_subscription_tier))
          return
        }

        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user || cancelled) {
          if (!cancelled) {
            setBusinessId(null)
            setTier(DEFAULT_SERVICE_SUBSCRIPTION_TIER)
          }
          return
        }

        const b = await getCurrentBusiness(supabase, user.id)
        if (cancelled) return
        setBusinessId(b?.id ?? null)
        setTier(parseServiceSubscriptionTier((b as { service_subscription_tier?: string } | null)?.service_subscription_tier))
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

  const value = useMemo<ServiceSubscriptionContextValue>(
    () => ({
      tier,
      businessId,
      loading,
      canAccessTier,
    }),
    [tier, businessId, loading, canAccessTier]
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
