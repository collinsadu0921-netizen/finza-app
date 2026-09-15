"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  CUSTOMER_DISPLAY_DIAGNOSTIC_DEFAULT_PROFILE_ID,
  CUSTOMER_DISPLAY_DIAGNOSTIC_POWER_CYCLE_HINT,
  CUSTOMER_DISPLAY_DIAGNOSTIC_TESTS,
  CUSTOMER_DISPLAY_SERIAL_PROFILES,
  bytesToHexPreview,
  buildCustomerDisplayDiagnosticBytes,
  getCustomerDisplayDiagnosticTest,
  getCustomerDisplaySerialProfile,
  type CustomerDisplayDiagnosticLogEntry,
  type CustomerDisplayDiagnosticTestId,
  type CustomerDisplaySerialProfile,
} from "@/lib/retail/hardware/customerDisplayDiagnostic"
import {
  resolveCustomerDisplayIntent,
  type CustomerDisplaySaleSuccess,
} from "@/lib/retail/hardware/customerDisplayProtocol"
import {
  connectCustomerDisplay,
  disconnectCustomerDisplay,
  getCustomerDisplayBaudRate,
  getCustomerDisplayLastError,
  getCustomerDisplayStatus,
  isCustomerDisplayDiagnosticMode,
  listCustomerDisplayDiagnosticLog,
  reconnectCustomerDisplayWithProfile,
  setCustomerDisplayDiagnosticMode,
  writeCustomerDisplayAmount,
  writeCustomerDisplayDiagnosticTest,
  type RetailHardwareStatus,
} from "@/lib/retail/hardware/retailPosHardware"

export function useRetailPosHardware(opts: {
  cartCount: number
  runningTotal: number
  checkoutOpen: boolean
  saleSuccess: CustomerDisplaySaleSuccess
  /** Owner/admin only — enables the Customer Display Diagnostic panel. */
  canUseDiagnostics?: boolean
}) {
  const canUseDiagnostics = opts.canUseDiagnostics === true
  const [status, setStatus] = useState<RetailHardwareStatus>("disconnected")
  const [lastError, setLastError] = useState("")
  const [busy, setBusy] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [diagnosticMode, setDiagnosticMode] = useState(false)
  const [profileId, setProfileId] = useState<CustomerDisplaySerialProfile["id"]>(
    CUSTOMER_DISPLAY_DIAGNOSTIC_DEFAULT_PROFILE_ID
  )
  const [pendingTestId, setPendingTestId] = useState<CustomerDisplayDiagnosticTestId>("ascii_0_00")
  const [lastHexPreview, setLastHexPreview] = useState("")
  const [diagnosticLog, setDiagnosticLog] = useState<CustomerDisplayDiagnosticLogEntry[]>([])
  const [baudRate, setBaudRate] = useState<number | null>(null)
  const idleTimerRef = useRef<number | null>(null)

  const refresh = useCallback(() => {
    setStatus(getCustomerDisplayStatus())
    setLastError(getCustomerDisplayLastError())
    setBaudRate(getCustomerDisplayBaudRate())
    setDiagnosticMode(isCustomerDisplayDiagnosticMode())
    setDiagnosticLog(listCustomerDisplayDiagnosticLog())
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const bytes = buildCustomerDisplayDiagnosticBytes(pendingTestId)
    setLastHexPreview(bytesToHexPreview(bytes))
  }, [pendingTestId])

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
      diagnosticMode,
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
    diagnosticMode,
    opts.cartCount,
    opts.runningTotal,
    opts.checkoutOpen,
    opts.saleSuccess,
    opts.saleSuccess?.cashReceived,
    opts.saleSuccess?.changeGiven,
    clearIdleTimer,
  ])

  const selectedProfile = useMemo(() => getCustomerDisplaySerialProfile(profileId), [profileId])

  const connect = useCallback(async () => {
    setBusy(true)
    try {
      await connectCustomerDisplay({
        profile: canUseDiagnostics && diagnosticMode ? selectedProfile : null,
        diagnosticMode: canUseDiagnostics && diagnosticMode,
      })
    } catch (e: unknown) {
      setLastError(e instanceof Error ? e.message : "Could not connect customer display.")
    } finally {
      refresh()
      setBusy(false)
    }
  }, [canUseDiagnostics, diagnosticMode, selectedProfile, refresh])

  const disconnect = useCallback(async () => {
    setBusy(true)
    try {
      await disconnectCustomerDisplay()
    } finally {
      refresh()
      setBusy(false)
    }
  }, [refresh])

  const enableDiagnostics = useCallback(async () => {
    if (!canUseDiagnostics) return
    setDiagnosticMode(true)
    await setCustomerDisplayDiagnosticMode(true)
    clearIdleTimer()
    refresh()
  }, [canUseDiagnostics, clearIdleTimer, refresh])

  const disableDiagnostics = useCallback(async () => {
    setDiagnosticMode(false)
    await setCustomerDisplayDiagnosticMode(false)
    refresh()
  }, [refresh])

  const applyProfile = useCallback(
    async (nextId: CustomerDisplaySerialProfile["id"]) => {
      if (!canUseDiagnostics) return
      setProfileId(nextId)
      const profile = getCustomerDisplaySerialProfile(nextId)
      if (getCustomerDisplayStatus() !== "connected" && getCustomerDisplayStatus() !== "error") {
        return
      }
      setBusy(true)
      try {
        await reconnectCustomerDisplayWithProfile(profile, { diagnosticMode: true })
        await setCustomerDisplayDiagnosticMode(true)
        setDiagnosticMode(true)
      } catch (e: unknown) {
        setLastError(e instanceof Error ? e.message : "Could not reopen the serial port at the new baud rate.")
      } finally {
        refresh()
        setBusy(false)
      }
    },
    [canUseDiagnostics, refresh]
  )

  const previewDiagnosticTest = useCallback((testId: CustomerDisplayDiagnosticTestId) => {
    setPendingTestId(testId)
    setLastHexPreview(bytesToHexPreview(buildCustomerDisplayDiagnosticBytes(testId)))
  }, [])

  const runDiagnosticTest = useCallback(
    async (testId: CustomerDisplayDiagnosticTestId) => {
      if (!canUseDiagnostics || !diagnosticMode) return
      previewDiagnosticTest(testId)
      setBusy(true)
      try {
        await writeCustomerDisplayDiagnosticTest(testId)
      } finally {
        refresh()
        setBusy(false)
      }
    },
    [canUseDiagnostics, diagnosticMode, previewDiagnosticTest, refresh]
  )

  const statusLabel = useMemo(() => {
    if (status === "connected") {
      return diagnosticMode
        ? `Display connected · diagnostic · ${baudRate ?? "—"} baud`
        : "Display connected"
    }
    if (status === "error") return "Display error"
    return "Display off"
  }, [status, diagnosticMode, baudRate])

  const pendingTest = useMemo(() => getCustomerDisplayDiagnosticTest(pendingTestId), [pendingTestId])

  return {
    status,
    statusLabel,
    lastError,
    busy,
    panelOpen,
    setPanelOpen,
    connect,
    disconnect,
    canUseDiagnostics,
    diagnosticMode,
    enableDiagnostics,
    disableDiagnostics,
    profiles: CUSTOMER_DISPLAY_SERIAL_PROFILES,
    profileId,
    applyProfile,
    powerCycleHint: CUSTOMER_DISPLAY_DIAGNOSTIC_POWER_CYCLE_HINT,
    tests: CUSTOMER_DISPLAY_DIAGNOSTIC_TESTS,
    pendingTestId,
    pendingTest,
    lastHexPreview,
    previewDiagnosticTest,
    runDiagnosticTest,
    diagnosticLog,
    baudRate,
  }
}
