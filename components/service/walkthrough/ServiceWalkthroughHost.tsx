"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { TourDefinition } from "./tourRegistry"
import { TOUR_POLL_INTERVAL_MS, TOUR_POLL_MAX_ATTEMPTS } from "./tourRegistry"
import {
  isElementReasonablyVisible,
  REMEASURE_AFTER_SCROLL_MS,
  scrollTargetIntoViewSmooth,
} from "./serviceWalkthroughViewport"
import "./serviceWalkthrough.css"

type Rect = { top: number; left: number; width: number; height: number }

type Props = {
  tour: TourDefinition
  stepIndex: number
  onStepIndexChange: (n: number | ((p: number) => number)) => void
  onSkipAll: () => void | Promise<void>
  onCompleteLast: () => void | Promise<void>
}

export function ServiceWalkthroughHost({
  tour,
  stepIndex,
  onStepIndexChange,
  onSkipAll,
  onCompleteLast,
}: Props) {
  const step = tour.steps[stepIndex]
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [targetBox, setTargetBox] = useState<Rect | null>(null)
  const [targetMissing, setTargetMissing] = useState(false)

  const selector = step?.targetSelector ?? ""

  useLayoutEffect(() => {
    if (!selector) {
      setTargetBox(null)
      setTargetMissing(true)
      return
    }
    let cancelled = false
    let attempts = 0
    let didScrollIntoView = false
    const pendingTimeouts: NodeJS.Timeout[] = []
    setTargetMissing(false)
    setTargetBox(null)

    const applyRect = (element: Element) => {
      const r = element.getBoundingClientRect()
      setTargetBox({
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
      })
      setTargetMissing(false)
    }

    const handleFoundElement = (el: Element) => {
      if (cancelled) return
      if (isElementReasonablyVisible(el)) {
        applyRect(el)
        return
      }
      if (!didScrollIntoView) {
        didScrollIntoView = true
        scrollTargetIntoViewSmooth(el)
        const tid = setTimeout(() => {
          if (cancelled) return
          window.requestAnimationFrame(() => {
            if (cancelled) return
            const el2 = document.querySelector(selector)
            applyRect(el2 ?? el)
          })
        }, REMEASURE_AFTER_SCROLL_MS)
        pendingTimeouts.push(tid)
        return
      }
      applyRect(el)
    }

    const measure = () => {
      if (cancelled) return
      const el = document.querySelector(selector)
      if (el) {
        handleFoundElement(el)
        return
      }
      attempts += 1
      if (attempts >= TOUR_POLL_MAX_ATTEMPTS) {
        setTargetBox(null)
        setTargetMissing(true)
        window.setTimeout(() => {
          if (cancelled) return
          if (stepIndex < tour.steps.length - 1) {
            onStepIndexChange((i) => i + 1)
          } else {
            void onSkipAll()
          }
        }, 0)
        return
      }
      window.setTimeout(measure, TOUR_POLL_INTERVAL_MS)
    }

    measure()
    return () => {
      cancelled = true
      for (const tid of pendingTimeouts) clearTimeout(tid)
    }
  }, [selector, stepIndex, tour.steps.length, tour.tourKey, onStepIndexChange, onSkipAll])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        void onSkipAll()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onSkipAll])

  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      panelRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(id)
  }, [stepIndex, tour.tourKey])

  const onResize = useCallback(() => {
    if (!selector) return
    const el = document.querySelector(selector)
    if (!el) return
    const r = el.getBoundingClientRect()
    setTargetBox({
      top: r.top,
      left: r.left,
      width: r.width,
      height: r.height,
    })
  }, [selector])

  useEffect(() => {
    window.addEventListener("scroll", onResize, true)
    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("scroll", onResize, true)
      window.removeEventListener("resize", onResize)
    }
  }, [onResize])

  const last = stepIndex >= tour.steps.length - 1

  const goNext = useCallback(() => {
    if (last) {
      void onCompleteLast()
    } else {
      onStepIndexChange((i) => i + 1)
    }
  }, [last, onCompleteLast, onStepIndexChange])

  const goBack = useCallback(() => {
    if (stepIndex <= 0) return
    onStepIndexChange((i) => i - 1)
  }, [onStepIndexChange, stepIndex])

  if (typeof document === "undefined" || !step) return null

  const ring =
    targetBox && !targetMissing ? (
      <div
        className="pointer-events-none fixed z-[86] rounded-lg ring-2 ring-white/90 ring-offset-2 ring-offset-slate-900/40 shadow-[0_0_0_9999px_rgba(15,23,42,0.55)]"
        style={{
          top: targetBox.top,
          left: targetBox.left,
          width: Math.max(targetBox.width, 44),
          height: Math.max(targetBox.height, 44),
        }}
        aria-hidden
      />
    ) : (
      <div className="pointer-events-none fixed inset-0 z-[85] bg-slate-900/55" aria-hidden />
    )

  const tooltip = (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="service-walkthrough-title"
      tabIndex={-1}
      className="fixed z-[90] w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-4 shadow-2xl outline-none dark:border-slate-600 dark:bg-slate-900"
      style={{
        left: "50%",
        bottom: "max(1rem, env(safe-area-inset-bottom))",
        transform: "translateX(-50%)",
      }}
    >
      <p id="service-walkthrough-title" className="text-sm font-semibold text-slate-900 dark:text-white">
        {step.title}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{step.body}</p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="text-sm font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
          onClick={() => void onSkipAll()}
        >
          Skip tour
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={stepIndex <= 0}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            onClick={goBack}
          >
            Back
          </button>
          <button
            type="button"
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
            onClick={goNext}
          >
            {last ? "Done" : "Next"}
          </button>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
        Step {stepIndex + 1} of {tour.steps.length} · Esc to skip
      </p>
    </div>
  )

  return createPortal(
    <>
      {ring}
      {tooltip}
    </>,
    document.body
  )
}
