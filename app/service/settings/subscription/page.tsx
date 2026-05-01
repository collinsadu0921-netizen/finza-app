"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useServiceSubscription } from "@/components/service/ServiceSubscriptionContext"
import { useToast } from "@/components/ui/ToastProvider"
import {
  SERVICE_TIER_LABEL,
  SERVICE_TIER_RANK,
  type ServiceSubscriptionTier,
} from "@/lib/serviceWorkspace/subscriptionTiers"
import {
  TIER_PRICING,
  BILLING_CYCLE_LABEL,
  billingCycleSavings,
  monthlyEquivalent,
  type BillingCycle,
} from "@/lib/serviceWorkspace/subscriptionPricing"
import { formatMoney } from "@/lib/money"
import { NativeSelect } from "@/components/ui/NativeSelect"
import { buildServiceRoute } from "@/lib/service/routes"

const BILLING_CYCLES_SET = new Set<string>(["monthly", "quarterly", "annual"])

function formatDate(d: Date | null): string {
  if (!d) return "—"
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
}

type TierSection = {
  section: string
  items: string[]
}

type TierConfig = {
  description: string
  inheritText?: string
  sections: TierSection[]
}

const TIER_FEATURES: Record<ServiceSubscriptionTier, TierConfig> = {
  starter: {
    description: "Core financial operations for running your business",
    sections: [
      {
        section: "Financial Operations",
        items: [
          "Real-time business overview and performance tracking",
          "Customer management and activity history",
          "Quote creation and conversion to invoices",
          "Service-based workflow management",
        ],
      },
      {
        section: "Billing & Cash Management",
        items: [
          "Proforma invoice generation",
          "Invoice creation and tracking",
          "Payment recording and status tracking",
          "Credit notes and adjustments",
          "Expense tracking and categorisation",
        ],
      },
      {
        section: "Financial Reporting",
        items: [
          "Profit & Loss (real-time view)",
          "Balance Sheet (automatically generated)",
        ],
      },
      {
        section: "Tax & Compliance",
        items: ["VAT tracking and reporting"],
      },
      {
        section: "Business Configuration",
        items: [
          "Business profile management",
          "Invoice configuration (numbering, structure)",
          "Payment setup and preferences",
          "Send by email or WhatsApp (wa.me link)",
        ],
      },
    ],
  },
  professional: {
    description: "Operational control and structured financial management",
    inheritText: "Everything in Essentials, plus:",
    sections: [
      {
        section: "Operations & Resource Management",
        items: [
          "Project tracking and management",
          "Material usage tracking",
          "Supplier bill management",
        ],
      },
      {
        section: "Workforce & Internal Management",
        items: [
          "Payroll processing",
          "Salary advances management",
          "Team member access control",
          "Staff management",
        ],
      },
      {
        section: "Financial Management & Reporting",
        items: [
          "Fixed asset tracking",
          "Cash flow statement",
          "Statement of changes in equity",
        ],
      },
      {
        section: "Tax & Regulatory Reporting",
        items: [
          "VAT return preparation",
          "Withholding tax (WHT) tracking and returns",
        ],
      },
      {
        section: "Collaboration & Oversight",
        items: [
          "Accountant collaboration requests",
          "Accounting activity log",
        ],
      },
    ],
  },
  business: {
    description: "Full financial control with accounting-grade infrastructure",
    inheritText: "Everything in Professional, plus:",
    sections: [
      {
        section: "Core Accounting Infrastructure",
        items: [
          "General Ledger (system-generated and continuously updated)",
          "Chart of Accounts management",
          "Trial Balance (automatically maintained)",
        ],
      },
      {
        section: "Reconciliation & Accuracy Control",
        items: [
          "Transaction reconciliation",
          "Bank reconciliation",
        ],
      },
      {
        section: "Financial Governance",
        items: [
          "Accounting period management",
          "Period closing controls",
        ],
      },
      {
        section: "Capital & Financial Structuring",
        items: [
          "Loan tracking and management",
          "Equity tracking and structuring",
          "Corporate Income Tax (CIT) provisions",
        ],
      },
      {
        section: "Audit & System Integrity",
        items: [
          "Full system audit log",
          "End-to-end financial traceability",
        ],
      },
    ],
  },
}

const TIER_COLOR: Record<ServiceSubscriptionTier, string> = {
  starter:      "border-slate-200 bg-white",
  professional: "border-blue-200 bg-blue-50",
  business:     "border-purple-200 bg-purple-50",
}

const TIER_BADGE: Record<ServiceSubscriptionTier, string> = {
  starter:      "bg-slate-100 text-slate-700",
  professional: "bg-blue-100 text-blue-700",
  business:     "bg-purple-100 text-purple-700",
}

const BILLING_CYCLES: BillingCycle[] = ["monthly", "quarterly", "annual"]
const TIER_ORDER: ServiceSubscriptionTier[] = ["starter", "professional", "business"]

function formatGHS(amount: number): string {
  return formatMoney(amount, "GHS")
}

/** Whole calendar days until `end` (0 if already passed). */
function wholeDaysUntil(end: Date | null): number | null {
  if (!end) return null
  const ms = end.getTime() - Date.now()
  if (ms <= 0) return 0
  return Math.ceil(ms / (24 * 60 * 60 * 1000))
}

function SubscriptionCallbackHandler() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const toast = useToast()
  const { businessId } = useServiceSubscription()

  useEffect(() => {
    if (searchParams.get("sub_callback") !== "1") return
    const ref = searchParams.get("reference") || searchParams.get("trxref")
    if (!ref) {
      toast.showToast("Missing payment reference from Paystack.", "error")
      router.replace(buildServiceRoute("/service/settings/subscription", businessId ?? undefined))
      return
    }
    if (!businessId) return
    let alive = true
    ;(async () => {
      for (let i = 0; i < 15; i++) {
        const r = await fetch(
          `/api/payments/subscription/verify?reference=${encodeURIComponent(ref)}&business_id=${encodeURIComponent(businessId)}`,
          { cache: "no-store" }
        )
        const j = await r.json()
        if (!alive) return
        if (j.status === "success") {
          toast.showToast(
            "Payment confirmed. Your plan will update shortly. Your billing period runs from this payment.",
            "success"
          )
          router.replace(buildServiceRoute("/service/settings/subscription", businessId ?? undefined))
          router.refresh()
          return
        }
        if (j.status === "failed" || j.status === "abandoned") {
          toast.showToast("Payment was not completed.", "error")
          router.replace(buildServiceRoute("/service/settings/subscription", businessId ?? undefined))
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 1500))
      }
      toast.showToast("Still processing — refresh this page shortly.", "info")
      router.replace(buildServiceRoute("/service/settings/subscription", businessId ?? undefined))
    })()
    return () => {
      alive = false
    }
  }, [searchParams, router, toast, businessId])

  return null
}

type SubscriptionGatewayOption = "paystack" | "mtn_momo_sandbox"
type SubscriptionProviderFlagState = { mock_checkout_enabled: boolean }

function tierPrimaryCtaLine(
  currentTier: ServiceSubscriptionTier,
  targetTier: ServiceSubscriptionTier
): string {
  const label = SERVICE_TIER_LABEL[targetTier]
  const upgradeTier = SERVICE_TIER_RANK[targetTier] > SERVICE_TIER_RANK[currentTier]
  return upgradeTier ? `Upgrade to ${label}` : `Start ${label} plan`
}

function SubscriptionPaystackActions({
  businessId,
  currentTier,
  targetTier,
  cycle,
  disabled,
}: {
  businessId: string | null
  currentTier: ServiceSubscriptionTier
  targetTier: ServiceSubscriptionTier
  cycle: BillingCycle
  disabled: boolean
}) {
  const toast = useToast()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [showMomo, setShowMomo] = useState(false)
  const [phone, setPhone] = useState("")
  const [momoProvider, setMomoProvider] = useState<"mtn" | "vodafone" | "airteltigo">("mtn")
  const [gateways, setGateways] = useState<{ paystack: boolean; mtn_momo_sandbox: boolean } | null>(null)
  const [gateway, setGateway] = useState<SubscriptionGatewayOption>("paystack")
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let alive = true
    fetch("/api/payments/subscription/options")
      .then((r) => r.json())
      .then((o: { paystack?: boolean; mtn_momo_sandbox?: boolean }) => {
        if (!alive) return
        const g = { paystack: !!o.paystack, mtn_momo_sandbox: !!o.mtn_momo_sandbox }
        setGateways(g)
        if (g.paystack) setGateway("paystack")
        else if (g.mtn_momo_sandbox) setGateway("mtn_momo_sandbox")
        if (
          process.env.NODE_ENV === "development" &&
          !g.paystack &&
          !g.mtn_momo_sandbox
        ) {
          console.warn(
            "[subscription UI] No Paystack secret or MTN sandbox config — online checkout hidden. Ensure PAYSTACK_SECRET_KEY is set for server routes in this environment."
          )
        }
      })
      .catch(() => {
        if (!alive) return
        setGateways({ paystack: false, mtn_momo_sandbox: false })
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (gateway === "mtn_momo_sandbox") setMomoProvider("mtn")
  }, [gateway])

  const startCard = async () => {
    if (!businessId || disabled) return
    setBusy(true)
    try {
      const res = await fetch("/api/payments/subscription/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gateway: "paystack",
          business_id: businessId,
          target_tier: targetTier,
          billing_cycle: cycle,
          channel: "card",
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not start checkout")
      if (data.authorization_url) {
        window.location.href = data.authorization_url as string
        return
      }
      throw new Error("No checkout URL returned")
    } catch (e: unknown) {
      toast.showToast(e instanceof Error ? e.message : "Checkout failed", "error")
    } finally {
      setBusy(false)
    }
  }

  const startMomo = async () => {
    if (!businessId || disabled) return
    if (!phone.trim()) {
      toast.showToast("Enter your Mobile Money number", "error")
      return
    }
    if (gateway === "mtn_momo_sandbox" && momoProvider !== "mtn") {
      toast.showToast("MTN sandbox checkout supports MTN MoMo only. Switch gateway to Paystack for other networks.", "error")
      return
    }
    setBusy(true)
    try {
      const res = await fetch("/api/payments/subscription/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gateway,
          business_id: businessId,
          target_tier: targetTier,
          billing_cycle: cycle,
          channel: "momo",
          phone: phone.trim(),
          momo_provider: momoProvider,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not start MoMo charge")

      let reference = data.reference as string

      if (gateway === "paystack" && data.otp_required) {
        const otp =
          typeof window !== "undefined"
            ? window.prompt("Enter the OTP sent to your phone (Vodafone Cash)")
            : null
        if (!otp?.trim()) {
          toast.showToast("OTP is required to complete payment", "error")
          return
        }
        const otpRes = await fetch("/api/payments/paystack/submit-otp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ otp: otp.trim(), reference }),
        })
        const otpJson = await otpRes.json()
        if (!otpRes.ok || !otpJson.success) {
          throw new Error(otpJson.error || "OTP verification failed")
        }
        reference = otpJson.reference || reference
      }

      if (gateway === "mtn_momo_sandbox") {
        toast.showToast(
          "Approve the payment on your phone. We will confirm with MTN and update your plan when payment succeeds.",
          "success"
        )
        setShowMomo(false)
        if (pollRef.current) clearInterval(pollRef.current)
        let attempts = 0
        pollRef.current = setInterval(async () => {
          attempts++
          if (attempts > 45) {
            if (pollRef.current) clearInterval(pollRef.current)
            pollRef.current = null
            toast.showToast("Payment is still pending — refresh this page or check back shortly.", "info")
            return
          }
          try {
            const vr = await fetch(
              `/api/payments/subscription/verify?reference=${encodeURIComponent(reference)}&business_id=${encodeURIComponent(businessId)}&gateway=mtn_momo_sandbox`,
              { cache: "no-store" }
            )
            const vj = await vr.json()
            if (vj.status === "success") {
              if (pollRef.current) clearInterval(pollRef.current)
              pollRef.current = null
              toast.showToast(
                "Payment confirmed. Your billing period runs from this payment.",
                "success"
              )
              router.refresh()
            } else if (vj.status === "failed" || vj.status === "abandoned") {
              if (pollRef.current) clearInterval(pollRef.current)
              pollRef.current = null
              toast.showToast(vj.message || "Payment was not completed.", "error")
            }
          } catch {
            /* next poll */
          }
        }, 2000)
        return
      }

      toast.showToast(
        "Approve the payment on your phone. When it succeeds, your plan updates and a new billing period starts from that time.",
        "success"
      )
      setShowMomo(false)
    } catch (e: unknown) {
      toast.showToast(e instanceof Error ? e.message : "MoMo payment failed", "error")
    } finally {
      setBusy(false)
    }
  }

  const showGatewayPicker =
    gateways && gateways.paystack && gateways.mtn_momo_sandbox
  const optionsReady = gateways !== null
  const noGatewayConfigured =
    optionsReady && gateways && !gateways.paystack && !gateways.mtn_momo_sandbox
  const primaryLine = tierPrimaryCtaLine(currentTier, targetTier)

  if (noGatewayConfigured) {
    return (
      <div className="mt-4 space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-medium text-amber-900">Online checkout isn&apos;t available here</p>
        <p className="text-xs leading-relaxed text-amber-800">
          We couldn&apos;t enable card or Mobile Money checkout on this deployment. Your team may need to add
          server-side Paystack credentials for this environment, or you may be on a preview build without production
          keys. You can still reach us below.
        </p>
        <a
          href={`mailto:hello@finza.app?subject=${encodeURIComponent(`Upgrade — ${SERVICE_TIER_LABEL[targetTier]}`)}`}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-800 py-2 text-center text-sm font-medium text-white transition-colors hover:bg-slate-700"
        >
          Email hello@finza.app
        </a>
      </div>
    )
  }

  return (
    <div className="mt-4 space-y-2">
      <p className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] leading-relaxed text-slate-600">
        Upgrades are billed at the <span className="font-medium text-slate-700">full price</span> for the plan and
        billing cycle shown. Your new subscription period begins when payment succeeds. We do not prorate or apply
        unused-time credit.
      </p>
      {showGatewayPicker && (
        <div className="rounded-md border border-slate-200 bg-white px-2.5 py-2">
          <p className="mb-1.5 text-[11px] font-medium text-slate-600">Payment gateway</p>
          <div className="flex flex-wrap gap-3 text-xs text-slate-700">
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name={`sub-gateway-${targetTier}`}
                checked={gateway === "paystack"}
                onChange={() => setGateway("paystack")}
                className="accent-slate-800"
              />
              Paystack (card + all MoMo networks)
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name={`sub-gateway-${targetTier}`}
                checked={gateway === "mtn_momo_sandbox"}
                onChange={() => setGateway("mtn_momo_sandbox")}
                className="accent-slate-800"
              />
              MTN MoMo (sandbox API)
            </label>
          </div>
        </div>
      )}
      {gateways?.paystack && gateway === "paystack" && (
      <button
        type="button"
        disabled={disabled || busy || !businessId || !optionsReady}
        onClick={() => void startCard()}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-800 py-2 text-center text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {primaryLine}
      </button>
      )}
      {!showMomo ? (
        <button
          type="button"
          disabled={disabled || busy || !businessId || !optionsReady}
          onClick={() => setShowMomo(true)}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white py-2 text-center text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Pay with Mobile Money
        </button>
      ) : (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
          <label className="block text-xs font-medium text-slate-600">MoMo number</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. 0241234567"
            className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
          />
          <label className="block text-xs font-medium text-slate-600">Network</label>
          <NativeSelect
            value={momoProvider}
            onChange={(e) =>
              setMomoProvider(e.target.value as "mtn" | "vodafone" | "airteltigo")
            }
            size="sm"
            disabled={gateway === "mtn_momo_sandbox"}
          >
            <option value="mtn">MTN</option>
            <option value="vodafone">Vodafone</option>
            <option value="airteltigo">AirtelTigo</option>
          </NativeSelect>
          {gateway === "mtn_momo_sandbox" && (
            <p className="text-[11px] text-slate-500">Sandbox gateway: MTN wallets only.</p>
          )}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              disabled={busy || !optionsReady}
              onClick={() => void startMomo()}
              className="flex-1 rounded-lg bg-slate-800 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {busy ? "…" : "Charge MoMo"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setShowMomo(false)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <a
        href={`mailto:hello@finza.app?subject=Upgrade%20to%20${encodeURIComponent(SERVICE_TIER_LABEL[targetTier])}%20—%20help`}
        className="block text-center text-[11px] text-slate-400 underline hover:text-slate-600"
      >
        Need help or invoice billing? Email us
      </a>
    </div>
  )
}

function MockSubscriptionActions({
  businessId,
  targetTier,
  cycle,
  disabled,
}: {
  businessId: string | null
  targetTier: ServiceSubscriptionTier
  cycle: BillingCycle
  disabled: boolean
}) {
  const toast = useToast()
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const startMockCheckout = async () => {
    if (!businessId || disabled) return
    setBusy(true)
    try {
      const res = await fetch("/api/subscription/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          target_tier: targetTier,
          billing_cycle: cycle,
          provider: "mock",
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Could not start mock checkout")
      const baseUrl =
        typeof data.checkoutUrl === "string" && data.checkoutUrl
          ? data.checkoutUrl
          : "/service/settings/subscription/mock-checkout"
      const separator = baseUrl.includes("?") ? "&" : "?"
      const targetUrl =
        `${baseUrl}${separator}` +
        `checkout=${encodeURIComponent(String(data.checkoutSessionId || ""))}` +
        `&business_id=${encodeURIComponent(businessId)}` +
        `&tier=${encodeURIComponent(targetTier)}` +
        `&cycle=${encodeURIComponent(cycle)}`
      router.push(targetUrl)
    } catch (e: unknown) {
      toast.showToast(e instanceof Error ? e.message : "Mock checkout failed", "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 space-y-2">
      <p className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-[11px] leading-relaxed text-slate-600">
        Mock checkout mode is enabled. This simulates payment outcomes and updates subscription state without
        calling real payment providers.
      </p>
      <button
        type="button"
        disabled={disabled || busy || !businessId}
        onClick={() => void startMockCheckout()}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-slate-800 py-2 text-center text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Starting..." : "Open mock checkout"}
      </button>
    </div>
  )
}

function SubscriptionPageInner() {
  const toast = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()
  const {
    tier,
    effectiveTier,
    status,
    loading,
    businessId,
    isTrialing,
    trialExpired,
    trialEndsAt,
    trialStartedAt,
    trialDaysLeft,
    billingCycle,
    currentPeriodEndsAt,
    subscriptionStartedAt,
    periodExpired,
    daysUntilRenewal,
    graceEndsAt,
    inGracePeriod,
    subscriptionLocked,
  } = useServiceSubscription()
  const [cycle, setCycle] = useState<BillingCycle>("monthly")
  const [providerFlags, setProviderFlags] = useState<SubscriptionProviderFlagState>({
    mock_checkout_enabled: false,
  })

  // Pre-select the user's current billing cycle once context loads
  useEffect(() => {
    if (billingCycle && BILLING_CYCLES_SET.has(billingCycle)) {
      setCycle(billingCycle as BillingCycle)
    }
  }, [billingCycle])

  useEffect(() => {
    let alive = true
    fetch("/api/subscription/feature-flags", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: SubscriptionProviderFlagState) => {
        if (!alive) return
        setProviderFlags({
          mock_checkout_enabled: !!data?.mock_checkout_enabled,
        })
      })
      .catch(() => {
        if (!alive) return
        setProviderFlags({ mock_checkout_enabled: false })
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const result = searchParams.get("mock_result")
    if (!result) return
    if (result === "paid" || result === "success") {
      toast.showToast("Mock payment marked successful. Subscription updated.", "success")
    } else if (result === "failed" || result === "failure" || result === "cancelled" || result === "expired") {
      toast.showToast(`Mock checkout result: ${result}.`, "info")
    }
    router.replace(buildServiceRoute("/service/settings/subscription", businessId ?? undefined))
  }, [searchParams, toast, router, businessId])

  return (
    <div className="min-h-screen bg-slate-50">
      <SubscriptionCallbackHandler />
      <div className="mx-auto max-w-5xl px-4 py-10">

        {/* Header */}
        <div className="mb-8">
          <Link
            href={buildServiceRoute(
              "/service/settings/business-profile",
              searchParams.get("business_id")?.trim() || businessId || undefined
            )}
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Settings
          </Link>
          <h1 className="text-xl font-bold text-slate-900">Subscription & Plan</h1>
          <p className="mt-1 text-sm text-slate-500">
            Your plan determines which features are available in your workspace. Paid changes bill at the full listed
            price; each successful payment starts a new subscription period from that date.
          </p>
        </div>

        {/* Current plan + subscription status banner */}
        <div className="mb-8 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          {loading ? (
            <div className="space-y-2">
              <div className="h-4 w-24 animate-pulse rounded bg-slate-100" />
              <div className="h-7 w-36 animate-pulse rounded-md bg-slate-100" />
            </div>
          ) : (
            <>
              {/* Trial active */}
              {isTrialing && (
                <div className="mb-4 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
                  <svg className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-blue-800">
                      <span className="uppercase tracking-wide text-[11px] text-blue-600">Trial active</span>
                      {" · "}
                      <span className="font-medium">14-day trial</span>
                      {" · "}
                      <span className="font-medium">{SERVICE_TIER_LABEL[tier]}</span>
                    </p>
                    <p className="mt-1 text-xs text-blue-800">
                      {trialDaysLeft !== null && (
                        <>
                          <span className="font-semibold text-blue-900">
                            {trialDaysLeft === 0
                              ? "Last day of your trial"
                              : trialDaysLeft === 1
                                ? "1 day left in your trial"
                                : `${trialDaysLeft} days left in your trial`}
                          </span>
                          {" · "}
                        </>
                      )}
                      Trial ends on <span className="font-medium">{formatDate(trialEndsAt)}</span>.
                      {trialStartedAt && (
                        <>
                          {" "}
                          Started <span className="font-medium">{formatDate(trialStartedAt)}</span>.
                        </>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-blue-700">
                      This is a free trial, not a paid subscription. Subscribe before your trial ends to keep full
                      access to {SERVICE_TIER_LABEL[tier]} features.
                    </p>
                  </div>
                </div>
              )}

              {/* Trial expired */}
              {trialExpired && (
                <div className="mb-4 flex items-start gap-3 rounded-lg border border-orange-200 bg-orange-50 p-4">
                  <svg className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-orange-800">Your free trial has ended</p>
                    <p className="mt-0.5 text-xs text-orange-700">
                      Trial ended on {formatDate(trialEndsAt)}. Your data is safe — subscribe below to restore access.
                    </p>
                  </div>
                </div>
              )}

              {/* Payment locked */}
              {subscriptionLocked && (
                <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
                  <svg className="mt-0.5 h-4 w-4 shrink-0 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-red-800">Subscription expired</p>
                    <p className="mt-0.5 text-xs text-red-700">
                      Your subscription has expired. Renew to continue using paid features.
                    </p>
                    <p className="mt-2 text-xs text-red-800">
                      Use the plan options below to subscribe or renew with card or Mobile Money.
                    </p>
                  </div>
                </div>
              )}

              {/* Past due — payment failed; grace window from subscription_grace_until */}
              {status === "past_due" && !subscriptionLocked && (
                <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-amber-900">Payment overdue — grace period</p>
                    <p className="mt-1 text-xs text-amber-800">
                      {graceEndsAt ? (
                        <>
                          Pay before{" "}
                          <span className="font-medium">{formatDate(graceEndsAt)}</span>
                          {(() => {
                            const d = wholeDaysUntil(graceEndsAt)
                            if (d === null) return null
                            if (d === 0) return <> (ends today).</>
                            if (d === 1) return <> (1 day remaining).</>
                            return <> ({d} days remaining).</>
                          })()}
                        </>
                      ) : (
                        <>Complete payment soon to avoid interruption.</>
                      )}
                    </p>
                  </div>
                </div>
              )}

              {/* Period expired — grace state (access still allowed but renewal needed) */}
              {!subscriptionLocked && periodExpired && (
                <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-amber-800">
                      {inGracePeriod ? "Grace period" : "Subscription period ended"}
                    </p>
                    <p className="mt-0.5 text-xs text-amber-700">
                      Your subscription period ended on{" "}
                      <span className="font-medium">{formatDate(currentPeriodEndsAt)}</span>.
                      You have limited time to renew.
                      {graceEndsAt && (
                        <> Access continues until{" "}
                          <span className="font-medium">{formatDate(graceEndsAt)}</span>.
                        </>
                      )}
                    </p>
                  </div>
                </div>
              )}

              {/* Active paid — current plan billing period */}
              {status === "active" && !periodExpired && !subscriptionLocked && (
                <div className="mb-4 flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                  <svg className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <div className="flex-1">
                    {currentPeriodEndsAt ? (
                      <>
                        <p className="text-sm font-semibold text-emerald-800">
                          Current billing period ends{" "}
                          <span className="font-bold">{formatDate(currentPeriodEndsAt)}</span>
                          {daysUntilRenewal !== null && (
                            <span className="ml-2 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                              {daysUntilRenewal === 0
                                ? "Due today"
                                : daysUntilRenewal === 1
                                  ? "1 day left"
                                  : `${daysUntilRenewal} days left`}
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 text-xs text-emerald-700">
                          {billingCycle ? `Billing cycle: ${BILLING_CYCLE_LABEL[billingCycle as BillingCycle] ?? billingCycle}. ` : ""}
                          {subscriptionStartedAt && (
                            <>
                              Member since <span className="font-medium">{formatDate(subscriptionStartedAt)}</span>.{" "}
                            </>
                          )}
                          Pay before this date to maintain uninterrupted access.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-semibold text-emerald-800">Active paid subscription</p>
                        <p className="mt-0.5 text-xs text-emerald-700">
                          Your plan is <span className="font-medium">{SERVICE_TIER_LABEL[effectiveTier]}</span>.
                          {billingCycle ? (
                            <>
                              {" "}
                              Billing cycle: {BILLING_CYCLE_LABEL[billingCycle as BillingCycle] ?? billingCycle}. Your
                              next renewal date will appear here after the first billing period is recorded.
                            </>
                          ) : (
                            <> Renewal dates will appear here after your first successful payment is recorded.</>
                          )}
                        </p>
                      </>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Current plan</p>
                  <p className="mt-1 text-2xl font-bold text-slate-900">{SERVICE_TIER_LABEL[effectiveTier]}</p>
                  <p className="mt-0.5 text-xs text-slate-500 capitalize">
                    Status:{" "}
                    <span className={
                      subscriptionLocked                     ? "text-red-600 font-medium" :
                      periodExpired                          ? "text-amber-600 font-medium" :
                      inGracePeriod                          ? "text-amber-600 font-medium" :
                      status === "active"                    ? "text-emerald-600 font-medium" :
                      status === "trialing"                  ? "text-blue-600 font-medium" :
                      "text-red-600 font-medium"
                    }>
                      {subscriptionLocked                              ? "Expired" :
                       periodExpired && inGracePeriod                  ? "Grace period" :
                       periodExpired                                   ? "Period ended" :
                       status === "trialing" && isTrialing             ? "Free trial" :
                       status === "trialing" && trialExpired           ? "Trial expired" :
                       status === "active"                             ? "Active" :
                       status === "past_due"                           ? "Grace period" :
                       status === "locked"                             ? "Expired" :
                       status}
                    </span>
                  </p>
                </div>
                {!loading && status === "active" && effectiveTier === "business" && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Highest plan
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Billing cycle toggle */}
        <div className="mb-6 flex justify-center">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
            {BILLING_CYCLES.map((c) => {
              const savings = billingCycleSavings(c, "starter") // same % across tiers
              return (
                <button
                  key={c}
                  onClick={() => setCycle(c)}
                  className={`relative rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                    cycle === c
                      ? "bg-slate-800 text-white shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {BILLING_CYCLE_LABEL[c]}
                  {savings > 0 && (
                    <span
                      className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                        cycle === c
                          ? "bg-emerald-400/30 text-emerald-100"
                          : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      Save {savings}%
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
        <p className="mx-auto mb-6 max-w-2xl px-2 text-center text-xs leading-relaxed text-slate-500">
          <span className="font-medium text-slate-600">Billing cycle:</span> Prices update when you switch Monthly,
          Quarterly, or Annual. If you pay after switching, you are charged the full amount for that cycle and a{" "}
          <span className="font-medium text-slate-600">new period begins immediately</span> from the payment date.
          There is no credit for unused time and no prorated adjustment. “Save %” compares paying a longer cycle
          upfront to paying month by month — it is not a refund from a previous subscription.
        </p>

        {/* Plan comparison cards */}
        <div className="grid gap-4 sm:grid-cols-3">
          {TIER_ORDER.map((t) => {
            const isCurrent   = t === effectiveTier
            // Show payment actions when: trial (any state), period expired (grace), or locked
            const needsSubscription = isTrialing || trialExpired || subscriptionLocked || periodExpired
            const isUpgrade   =
              !loading && !needsSubscription && SERVICE_TIER_RANK[t] > SERVICE_TIER_RANK[effectiveTier]
            const isDowngrade  =
              !loading && !needsSubscription && SERVICE_TIER_RANK[t] < SERVICE_TIER_RANK[effectiveTier]
            const isSubscribeTarget = !loading && needsSubscription
            const config     = TIER_FEATURES[t]
            const price      = TIER_PRICING[cycle][t]
            const perMonth   = monthlyEquivalent(cycle, t)
            const savings    = billingCycleSavings(cycle, t)

            return (
              <div
                key={t}
                className={`relative rounded-xl border p-5 shadow-sm ${TIER_COLOR[t]} ${
                  isCurrent ? "ring-2 ring-slate-800" : ""
                }`}
              >
                {isCurrent && (
                  <span className="absolute -top-2.5 left-4 rounded-full bg-slate-800 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                    Current
                  </span>
                )}

                <div className="mb-3">
                  <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${TIER_BADGE[t]}`}>
                    {SERVICE_TIER_LABEL[t]}
                  </span>
                </div>

                <p className="mb-3 text-xs text-slate-500">{config.description}</p>

                {/* Pricing */}
                <div className="mb-4">
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold text-slate-900">{formatGHS(price)}</span>
                    <span className="text-xs text-slate-500">
                      /{cycle === "monthly" ? "mo" : cycle === "quarterly" ? "qtr" : "yr"}
                    </span>
                  </div>
                  {cycle !== "monthly" && (
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatGHS(perMonth)}/mo equivalent
                      {savings > 0 && (
                        <span className="ml-1.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                          Save {savings}%
                        </span>
                      )}
                    </p>
                  )}
                </div>

                {config.inheritText && (
                  <p className="mb-3 text-xs font-medium text-slate-500">{config.inheritText}</p>
                )}
                {config.sections.map((group) => (
                  <div key={group.section} className="mb-3">
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      {group.section}
                    </p>
                    <ul className="space-y-1">
                      {group.items.map((item) => (
                        <li key={item} className="flex items-start gap-2 text-sm text-slate-700">
                          <svg
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2.5}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}

                {/* Subscribe CTA — shown during trial, trial-expired, or payment-locked */}
                {isSubscribeTarget && (
                  providerFlags.mock_checkout_enabled ? (
                    <MockSubscriptionActions
                      businessId={businessId}
                      targetTier={t}
                      cycle={cycle}
                      disabled={false}
                    />
                  ) : (
                    <SubscriptionPaystackActions
                      businessId={businessId}
                      currentTier={effectiveTier}
                      targetTier={t}
                      cycle={cycle}
                      disabled={false}
                    />
                  )
                )}

                {/* Upgrade (active paid subscriber going higher) — online checkout when configured */}
                {isUpgrade && (
                  providerFlags.mock_checkout_enabled ? (
                    <MockSubscriptionActions
                      businessId={businessId}
                      targetTier={t}
                      cycle={cycle}
                      disabled={false}
                    />
                  ) : (
                    <SubscriptionPaystackActions
                      businessId={businessId}
                      currentTier={effectiveTier}
                      targetTier={t}
                      cycle={cycle}
                      disabled={false}
                    />
                  )
                )}

                {/* Downgrade button (active paid subscriber going lower) */}
                {isDowngrade && (
                  <div className="mt-4 space-y-1.5">
                    <a
                      href={`mailto:hello@finza.app?subject=Downgrade%20to%20${encodeURIComponent(SERVICE_TIER_LABEL[t])}%20request`}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white py-2 text-center text-sm font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
                    >
                      Email to request {SERVICE_TIER_LABEL[t]}
                    </a>
                    <p className="text-center text-[11px] leading-relaxed text-slate-500">
                      Lower plans are handled <span className="font-medium text-slate-600">manually by our team</span>.
                      There is no self-serve downgrade and no automatic switch at your next renewal. We will confirm
                      access and billing with you. Moving down may remove features available on your current plan.
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Questions about billing or plan changes?{" "}
          <a href="mailto:hello@finza.app" className="underline hover:text-slate-600">
            hello@finza.app
          </a>
        </p>
      </div>
    </div>
  )
}

export default function SubscriptionPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
          Loading…
        </div>
      }
    >
      <SubscriptionPageInner />
    </Suspense>
  )
}
