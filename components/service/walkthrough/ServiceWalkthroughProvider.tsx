"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { useWorkspaceBusiness } from "@/components/WorkspaceBusinessContext"
import {
  getActiveTourForPath,
  getTourDefinitionByKey,
  normalizeServiceTourPathname,
  TOUR_START_DELAY_MS,
  type TourDefinition,
} from "./tourRegistry"
import { ServiceWalkthroughHost } from "./ServiceWalkthroughHost"
import {
  shouldSuppressTourFromProgress,
  withSavedTourProgress,
} from "./serviceWalkthroughProgressLogic"

type ProgressRow = { tour_key: string; tour_version: number; status: string }
type ProgressStatus = "completed" | "skipped"

export type ServiceWalkthroughContextValue = {
  replayTourKey: (tourKey: string) => void
}

const ServiceWalkthroughContext = createContext<ServiceWalkthroughContextValue | null>(null)

export function useServiceWalkthrough(): ServiceWalkthroughContextValue {
  return useContext(ServiceWalkthroughContext) ?? { replayTourKey: () => {} }
}

export function ServiceWalkthroughProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/"
  const searchParams = useSearchParams()
  const { business, sessionUser } = useWorkspaceBusiness()
  const businessId = business?.id ?? null
  const userId = sessionUser?.id ?? null

  const normalizedPath = useMemo(() => normalizeServiceTourPathname(pathname), [pathname])
  const forcedTourKey = (searchParams?.get("tour") ?? "").trim()

  const [progressByKey, setProgressByKey] = useState<Map<string, ProgressRow>>(new Map())
  const [progressLoading, setProgressLoading] = useState(false)
  const [progressLoaded, setProgressLoaded] = useState(false)
  const [progressLoadError, setProgressLoadError] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [tourOpen, setTourOpen] = useState(false)
  const [activeTour, setActiveTour] = useState<TourDefinition | null>(null)
  const [activeStepIndex, setActiveStepIndex] = useState(0)

  const autoStartedKeyRef = useRef<string | null>(null)
  const forcedStartedSigRef = useRef<string | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!businessId || !userId) {
      setProgressByKey(new Map())
      setProgressLoading(false)
      setProgressLoaded(false)
      setProgressLoadError(null)
    }
  }, [businessId, userId])

  const loadProgress = useCallback(async () => {
    if (!businessId || !userId) return
    setProgressLoading(true)
    setProgressLoadError(null)
    try {
      const res = await fetch(
        `/api/service/walkthrough/progress?business_id=${encodeURIComponent(businessId)}`,
        { credentials: "same-origin" }
      )
      if (!res.ok) {
        const bodyText = await res.text().catch(() => "")
        const message = `progress read failed (${res.status})${bodyText ? `: ${bodyText}` : ""}`
        console.warn("[service/walkthrough] GET /progress", message)
        setProgressLoadError(message)
        setProgressLoaded(true)
        return
      }
      const j = (await res.json()) as { rows?: ProgressRow[] }
      const m = new Map<string, ProgressRow>()
      for (const r of j.rows ?? []) {
        if (r.tour_key) m.set(r.tour_key, r)
      }
      setProgressByKey(m)
      setProgressLoaded(true)
    } catch (error) {
      const msg = error instanceof Error ? error.message : "unknown error"
      console.error("[service/walkthrough] GET /progress", msg)
      setProgressLoadError(msg)
      setProgressLoaded(true)
    } finally {
      setProgressLoading(false)
    }
  }, [businessId, userId])

  useEffect(() => {
    void loadProgress()
  }, [loadProgress])

  useEffect(() => {
    autoStartedKeyRef.current = null
    forcedStartedSigRef.current = null
  }, [normalizedPath, forcedTourKey])

  const shouldBlockAutoStart = useCallback(
    (def: TourDefinition) => {
      const row = progressByKey.get(def.tourKey)
      return shouldSuppressTourFromProgress(row, def.tourVersion)
    },
    [progressByKey]
  )

  const startTour = useCallback((def: TourDefinition, force: boolean) => {
    if (!def.steps.length) return
    if (!force && shouldBlockAutoStart(def)) return
    setActiveTour(def)
    setActiveStepIndex(0)
    setTourOpen(true)
  }, [shouldBlockAutoStart])

  const closeTour = useCallback(() => {
    setTourOpen(false)
    setActiveTour(null)
    setActiveStepIndex(0)
  }, [])

  const persist = useCallback(
    async (status: ProgressStatus) => {
      if (!activeTour || !businessId) return
      try {
        const res = await fetch("/api/service/walkthrough/progress", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            business_id: businessId,
            tour_key: activeTour.tourKey,
            tour_version: activeTour.tourVersion,
            status,
          }),
        })
        if (!res.ok) {
          const bodyText = await res.text().catch(() => "")
          console.error(
            "[service/walkthrough] POST /progress failed",
            `${res.status}${bodyText ? `: ${bodyText}` : ""}`
          )
          return
        }
        setProgressByKey((prev) =>
          withSavedTourProgress(prev, {
            tour_key: activeTour.tourKey,
            tour_version: activeTour.tourVersion,
            status,
          })
        )
        await loadProgress()
      } catch (error) {
        const msg = error instanceof Error ? error.message : "unknown error"
        console.error("[service/walkthrough] POST /progress failed", msg)
      }
    },
    [activeTour, businessId, loadProgress]
  )

  useEffect(() => {
    if (!mounted) return
    if (!businessId || !userId) return
    if (tourOpen) return
    if (progressLoading) return
    if (!progressLoaded) return

    const timer = window.setTimeout(() => {
      if (forcedTourKey) {
        const sig = `${forcedTourKey}::${normalizedPath}`
        if (forcedStartedSigRef.current === sig) return
        const def = getTourDefinitionByKey(forcedTourKey)
        if (def?.active && def.steps.length) {
          forcedStartedSigRef.current = sig
          startTour(def, true)
        }
        return
      }

      const def = getActiveTourForPath(normalizedPath)
      if (!def) return
      if (progressLoadError) {
        console.warn(
          "[service/walkthrough] auto-start skipped because progress could not be verified",
          progressLoadError
        )
        return
      }
      const marker = `${def.tourKey}::${normalizedPath}`
      if (autoStartedKeyRef.current === marker) return
      if (shouldBlockAutoStart(def)) {
        autoStartedKeyRef.current = marker
        return
      }
      autoStartedKeyRef.current = marker
      startTour(def, false)
    }, TOUR_START_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [
    mounted,
    businessId,
    userId,
    normalizedPath,
    forcedTourKey,
    tourOpen,
    progressLoading,
    progressLoaded,
    progressLoadError,
    startTour,
    shouldBlockAutoStart,
    progressByKey,
  ])

  const replayTourKey = useCallback(
    (key: string) => {
      const def = getTourDefinitionByKey(key)
      if (def?.active && def.steps.length) startTour(def, true)
    },
    [startTour]
  )

  const ctx = useMemo(() => ({ replayTourKey }), [replayTourKey])

  const onHostComplete = useCallback(async () => {
    await persist("completed")
    closeTour()
  }, [persist, closeTour])

  const onHostSkip = useCallback(async () => {
    await persist("skipped")
    closeTour()
  }, [persist, closeTour])

  return (
    <ServiceWalkthroughContext.Provider value={ctx}>
      {children}
      {tourOpen && activeTour ? (
        <ServiceWalkthroughHost
          tour={activeTour}
          stepIndex={activeStepIndex}
          onStepIndexChange={setActiveStepIndex}
          onSkipAll={onHostSkip}
          onCompleteLast={onHostComplete}
        />
      ) : null}
    </ServiceWalkthroughContext.Provider>
  )
}
