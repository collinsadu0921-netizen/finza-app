"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  resolveCustomerDisplayIntent,
  type CustomerDisplaySaleSuccess,
} from "@/lib/retail/hardware/customerDisplayProtocol"
import {
  connectCustomerDisplay,
  disconnectCustomerDisplay,
  getCustomerDisplayLastError,
  getCustomerDisplayStatus,
  writeCustomerDisplayAmount,
  type RetailHardwareStatus,
} from "@/lib/retail/hardware/retailPosHardware"

export function useRetailPosHardware(opts: {
  cartCount: number
  runningTotal: number
  checkoutOpen: boolean
  saleSuccess: CustomerDisplaySaleSuccess
}) {
  const [status, setStatus] = useState<RetailHardwareStatus>("disconnected")
  const [lastError, setLastError] = useState("")
  const [busy, setBusy] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const idleTimerRef = useRef<number | null>(null)

  const refresh = useCallback(() => {
    setStatus(getCustomerDisplayStatus())
    setLastError(getCustomerDisplayLastError())
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current != null) {
      window.clearTimeout(idleTimerRef.current)
      idleTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    const intent = resolveCustomerDisplayIntent({
      status,
      cartCount: opts.cartCount,
      runningTotal: opts.runningTotal,
      checkoutOpen: opts.checkoutOpen,
      saleSuccess: opts.saleSuccess,
    })

    const run = async () => {
      try {
        clearIdleTimer()
        if (intent.action === "none") return
        await writeCustomerDisplayAmount(intent.amount)
        if (intent.action === "writeThenIdle") {
          idleTimerRef.current = window.setTimeout(() => {
            void writeCustomerDisplayAmount(0).then(() => {
              setStatus(getCustomerDisplayStatus())
              setLastError(getCustomerDisplayLastError())
            })
          }, intent.idleAfterMs)
        }
      } catch {
        /* Display must never block the sale */
      } finally {
        setStatus(getCustomerDisplayStatus())
        setLastError(getCustomerDisplayLastError())
      }
    }
    void run()
    return () => {
      clearIdleTimer()
    }
  }, [
    status,
    opts.cartCount,
    opts.runningTotal,
    opts.checkoutOpen,
    opts.saleSuccess,
    opts.saleSuccess?.cashReceived,
    opts.saleSuccess?.changeGiven,
    clearIdleTimer,
  ])

  const connect = useCallback(async () => {
    setBusy(true)
    try {
      await connectCustomerDisplay()
    } catch (e: unknown) {
      setLastError(e instanceof Error ? e.message : "Could not connect customer display.")
    } finally {
      refresh()
      setBusy(false)
    }
  }, [refresh])

  const disconnect = useCallback(async () => {
    setBusy(true)
    try {
      await disconnectCustomerDisplay()
    } finally {
      refresh()
      setBusy(false)
    }
  }, [refresh])

  const statusLabel = useMemo(() => {
    if (status === "connected") return "Display connected"
    if (status === "error") return "Display error"
    return "Display off"
  }, [status])

  return {
    status,
    statusLabel,
    lastError,
    busy,
    panelOpen,
    setPanelOpen,
    connect,
    disconnect,
  }
}
