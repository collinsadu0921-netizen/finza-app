"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  connectCustomerDisplay,
  disconnectCustomerDisplay,
  getCustomerDisplayIdleMessage,
  getCustomerDisplayLastError,
  getCustomerDisplayStatus,
  pulseCashDrawer,
  readCashDrawerOpenLog,
  setCustomerDisplayIdleMessage,
  writeCustomerDisplayView,
  type CashDrawerOpenLogEntry,
  type RetailHardwareStatus,
} from "@/lib/retail/hardware/retailPosHardware"

export type RetailPosHardwareCartItem = {
  id: string
  name: string
  quantity: number
}

type SaleSuccessDisplay = {
  cashReceived?: number | null
  changeGiven?: number | null
} | null

export function useRetailPosHardware(opts: {
  cartItems: RetailPosHardwareCartItem[]
  runningTotal: number
  currencyCode: string | null
  checkoutOpen: boolean
  saleSuccess: SaleSuccessDisplay
  cashierName: string | null
}) {
  const [status, setStatus] = useState<RetailHardwareStatus>("disconnected")
  const [lastError, setLastError] = useState("")
  const [busy, setBusy] = useState(false)
  const [idleMessage, setIdleMessage] = useState("")
  const [drawerLog, setDrawerLog] = useState<CashDrawerOpenLogEntry[]>([])
  const [panelOpen, setPanelOpen] = useState(false)

  const refresh = useCallback(() => {
    setStatus(getCustomerDisplayStatus())
    setLastError(getCustomerDisplayLastError())
    setIdleMessage(getCustomerDisplayIdleMessage())
    setDrawerLog(readCashDrawerOpenLog())
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const latestItem = opts.cartItems[opts.cartItems.length - 1]

  useEffect(() => {
    if (status !== "connected") return
    const currency = opts.currencyCode || ""
    const run = async () => {
      try {
        if (opts.saleSuccess) {
          const tendered = Number(opts.saleSuccess.cashReceived ?? 0)
          const change = Number(opts.saleSuccess.changeGiven ?? 0)
          if (tendered > 0) {
            await writeCustomerDisplayView({
              kind: "tendered",
              tendered,
              change,
              currencyCode: currency,
            })
            return
          }
          await writeCustomerDisplayView({
            kind: "idle",
            idleMessage: getCustomerDisplayIdleMessage(),
          })
          return
        }
        if (opts.checkoutOpen) {
          await writeCustomerDisplayView({
            kind: "due",
            amountDue: opts.runningTotal,
            currencyCode: currency,
          })
          return
        }
        if (!latestItem) {
          await writeCustomerDisplayView({
            kind: "idle",
            idleMessage: getCustomerDisplayIdleMessage(),
          })
          return
        }
        await writeCustomerDisplayView({
          kind: "item",
          itemName: latestItem.name,
          runningTotal: opts.runningTotal,
          currencyCode: currency,
        })
      } catch {
        /* Display must never block the sale */
      } finally {
        setStatus(getCustomerDisplayStatus())
        setLastError(getCustomerDisplayLastError())
      }
    }
    void run()
  }, [
    status,
    latestItem,
    latestItem?.id,
    latestItem?.name,
    opts.runningTotal,
    opts.checkoutOpen,
    opts.saleSuccess,
    opts.saleSuccess?.cashReceived,
    opts.saleSuccess?.changeGiven,
    opts.currencyCode,
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

  const saveIdle = useCallback(
    (message: string) => {
      setCustomerDisplayIdleMessage(message)
      setIdleMessage(message)
      if (getCustomerDisplayStatus() === "connected" && opts.cartItems.length === 0 && !opts.checkoutOpen) {
        void writeCustomerDisplayView({ kind: "idle", idleMessage: message })
      }
    },
    [opts.cartItems.length, opts.checkoutOpen]
  )

  const openDrawer = useCallback(async () => {
    setBusy(true)
    try {
      const result = await pulseCashDrawer({
        cashier: opts.cashierName || "cashier",
        source: "manual",
      })
      refresh()
      return result
    } finally {
      setBusy(false)
    }
  }, [opts.cashierName, refresh])

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
    idleMessage,
    drawerLog,
    panelOpen,
    setPanelOpen,
    connect,
    disconnect,
    saveIdle,
    openDrawer,
  }
}
