"use client"

import { useEffect } from "react"

/**
 * Prevents scroll-wheel from changing the value of number inputs.
 * Blurs the input on wheel so the scroll goes to the page instead.
 * Works globally via a single delegated listener — no per-input wiring needed.
 */
export default function NumberInputGuard() {
  useEffect(() => {
    function onWheel(e: WheelEvent) {
      const target = e.target as HTMLElement
      if (target instanceof HTMLInputElement && target.type === "number") {
        target.blur()
      }
    }
    document.addEventListener("wheel", onWheel, { passive: true })
    return () => document.removeEventListener("wheel", onWheel)
  }, [])

  return null
}
