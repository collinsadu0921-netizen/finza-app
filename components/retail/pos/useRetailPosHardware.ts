"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  CANDIDATE_CLEAR_THEN_AMOUNT_WARNING,
  CUSTOMER_DISPLAY_DIAGNOSTIC_DEFAULT_PROFILE_ID,
  CUSTOMER_DISPLAY_DIAGNOSTIC_POWER_CYCLE_HINT,
  CUSTOMER_DISPLAY_DIAGNOSTIC_TESTS,
  CUSTOMER_DISPLAY_SERIAL_PROFILES,
  bytesToHexPreview,
  buildCandidateClearThenAmountPreview,
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
  defaultCustomerDisplayTerminalConfig,
  readCustomerDisplayTerminalConfig,
  resolveConnectSerialProfile,
  shouldAllowAutomaticCustomerDisplayUpdates,
  writeCustomerDisplayTerminalConfig,
  type CustomerDisplayTerminalConfig,
  type CustomerDisplayTerminalIdentity,
} from "@/lib/retail/hardware/customerDisplayTerminalConfig"
import {
  connectCustomerDisplay,
  disconnectCustomerDisplay,
  getCustomerDisplayBaudRate,
  getCustomerDisplayLastError,
  getCustomerDisplayStatus,
  isCustomerDisplayDiagnosticMode,
  listCustomerDisplayDiagnosticLog,
  reconnectCustomerDisplayWithProfile,
  setAutomaticCustomerDisplaySaleWritesEnabled,
  setCustomerDisplayDiagnosticMode,
  writeCustomerDisplayAmount,
  writeCustomerDisplayDiagnosticClearThenAmount,
  writeCustomerDisplayDiagnosticTest,
  type RetailHardwareStatus,
} from "@/lib/retail/hardware/retailPosHardware"

export function useRetailPosHardware(opts: {
  cartCount: number
  runningTotal: number
  checkoutOpen: boolean
  saleSuccess: CustomerDisplaySaleSuccess
  /** Owner/admin only — setup + advanced diagnostics. */
  canUseDiagnostics?: boolean
  /** Bound till identity — display config is per physical terminal. */
  terminalIdentity?: CustomerDisplayTerminalIdentity | null
}) {
  const canUseDiagnostics = opts.canUseDiagnostics === true
  const terminalIdentity = opts.terminalIdentity ?? null

  const [status, setStatus] = useState<RetailHardwareStatus>("disconnected")
  const [lastError, setLastError] = useState("")
  const [busy, setBusy] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [diagnosticMode, setDiagnosticMode] = useState(false)
  const [terminalConfig, setTerminalConfig] = useState<CustomerDisplayTerminalConfig>(
    defaultCustomerDisplayTerminalConfig()
  )
  const [profileId, setProfileId] = useState<CustomerDisplaySerialProfile["id"]>(
    CUSTOMER_DISPLAY_DIAGNOSTIC_DEFAULT_PROFILE_ID
  )
  const [pendingTestId, setPendingTestId] = useState<CustomerDisplayDiagnosticTestId>("ascii_0_00")
  const [lastHexPreview, setLastHexPreview] = useState("")
  const [sequenceAmountInput, setSequenceAmountInput] = useState("1234.56")
  const [sequenceMessage, setSequenceMessage] = useState("")
  const [diagnosticLog, setDiagnosticLog] = useState<CustomerDisplayDiagnosticLogEntry[]>([])
  const [baudRate, setBaudRate] = useState<number | null>(null)
  const [configMessage, setConfigMessage] = useState("")
  const idleTimerRef = useRef<number | null>(null)

  const reloadTerminalConfig = useCallback(() => {
    const stored = readCustomerDisplayTerminalConfig(terminalIdentity)
    const next = stored ?? defaultCustomerDisplayTerminalConfig()
    setTerminalConfig(next)
    setProfileId(next.profileId)
    return next
  }, [terminalIdentity])

  const refresh = useCallback(() => {
    setStatus(getCustomerDisplayStatus())
    setLastError(getCustomerDisplayLastError())
    setBaudRate(getCustomerDisplayBaudRate())
    setDiagnosticMode(isCustomerDisplayDiagnosticMode())
    setDiagnosticLog(listCustomerDisplayDiagnosticLog())
  }, [])

  useEffect(() => {
    reloadTerminalConfig()
    refresh()
  }, [reloadTerminalConfig, refresh])

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

  const autoUpdatesAllowed = shouldAllowAutomaticCustomerDisplayUpdates(terminalConfig)

  useEffect(() => {
    setAutomaticCustomerDisplaySaleWritesEnabled(autoUpdatesAllowed)
    return () => {
      setAutomaticCustomerDisplaySaleWritesEnabled(false)
    }
  }, [autoUpdatesAllowed])

  useEffect(() => {
    const intent = resolveCustomerDisplayIntent({
      status,
      cartCount: opts.cartCount,
      runningTotal: opts.runningTotal,
      checkoutOpen: opts.checkoutOpen,
      saleSuccess: opts.saleSuccess,
      diagnosticMode,
      autoUpdatesAllowed,
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
    autoUpdatesAllowed,
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
    setConfigMessage("")
    try {
      const profile = resolveConnectSerialProfile(terminalConfig, {
        diagnosticMode: canUseDiagnostics && diagnosticMode,
        diagnosticProfileId: profileId,
      })
      await connectCustomerDisplay({
        profile,
        diagnosticMode: canUseDiagnostics && diagnosticMode,
      })
    } catch (e: unknown) {
      setLastError(e instanceof Error ? e.message : "Could not connect customer display.")
    } finally {
      refresh()
      setBusy(false)
    }
  }, [
    canUseDiagnostics,
    diagnosticMode,
    profileId,
    terminalConfig,
    refresh,
  ])

  const disconnect = useCallback(async () => {
    setBusy(true)
    try {
      await disconnectCustomerDisplay()
    } finally {
      refresh()
      setBusy(false)
    }
  }, [refresh])

  const persistConfig = useCallback(
    (next: CustomerDisplayTerminalConfig) => {
      const ok = writeCustomerDisplayTerminalConfig(terminalIdentity, next)
      setTerminalConfig(next)
      setProfileId(next.profileId)
      if (!ok) {
        setConfigMessage(
          terminalIdentity
            ? "Could not save on this browser (storage blocked)."
            : "Bind this till to a register before saving a display profile."
        )
        return false
      }
      setConfigMessage("")
      return true
    },
    [terminalIdentity]
  )

  const saveCandidateProfile = useCallback(
    (nextId: CustomerDisplaySerialProfile["id"]) => {
      if (!canUseDiagnostics) return
      const next: CustomerDisplayTerminalConfig = {
        ...terminalConfig,
        profileId: nextId,
        // Changing baud clears physical verification — other tills / profiles must re-verify.
        physicallyVerified: false,
        verifiedAt: null,
        verifiedNote: null,
        updatedAt: new Date().toISOString(),
      }
      persistConfig(next)
      setProfileId(nextId)
    },
    [canUseDiagnostics, terminalConfig, persistConfig]
  )

  const markPhysicallyVerified = useCallback(() => {
    if (!canUseDiagnostics) return
    const next: CustomerDisplayTerminalConfig = {
      ...terminalConfig,
      profileId,
      physicallyVerified: true,
      verifiedAt: new Date().toISOString(),
      verifiedNote: `${getCustomerDisplaySerialProfile(profileId).baudRate} baud · 8N1 · plain ASCII amounts (this till only)`,
      updatedAt: new Date().toISOString(),
    }
    if (persistConfig(next)) {
      setConfigMessage("Saved as physically verified for this till. Automatic basket totals may resume when connected.")
    }
  }, [canUseDiagnostics, terminalConfig, profileId, persistConfig])

  const clearPhysicalVerification = useCallback(() => {
    if (!canUseDiagnostics) return
    const next: CustomerDisplayTerminalConfig = {
      ...terminalConfig,
      physicallyVerified: false,
      verifiedAt: null,
      verifiedNote: null,
      updatedAt: new Date().toISOString(),
    }
    if (persistConfig(next)) {
      setConfigMessage("Automatic basket totals disabled until this till is re-verified.")
    }
  }, [canUseDiagnostics, terminalConfig, persistConfig])

  const enableDiagnostics = useCallback(async () => {
    if (!canUseDiagnostics) return
    setDiagnosticMode(true)
    setAdvancedOpen(true)
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
      saveCandidateProfile(nextId)
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
    [canUseDiagnostics, saveCandidateProfile, refresh]
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

  const clearThenAmountPreview = useMemo(
    () => buildCandidateClearThenAmountPreview(sequenceAmountInput),
    [sequenceAmountInput]
  )

  const runClearThenAmount = useCallback(async () => {
    if (!canUseDiagnostics || !diagnosticMode) return
    if (getCustomerDisplayStatus() !== "connected") {
      setSequenceMessage("Connect the customer display before running this sequence.")
      return
    }
    const preview = buildCandidateClearThenAmountPreview(sequenceAmountInput)
    if (!preview.valid) {
      setSequenceMessage(preview.error || "Invalid amount.")
      return
    }
    setLastHexPreview(`${preview.clearHex} → ${preview.amountHex}`)
    setSequenceMessage("")
    setBusy(true)
    try {
      const result = await writeCustomerDisplayDiagnosticClearThenAmount(preview.ascii!)
      if (!result.clear.ok) {
        setSequenceMessage(
          `Clear write failed (${result.clear.error || "unknown"}). Amount was not sent. Log “OK” means write completed only.`
        )
      } else if (!result.amount?.ok) {
        setSequenceMessage(
          `Clear wrote OK; amount write failed (${result.amount?.error || "unknown"}). Log “OK” means write completed only.`
        )
      } else {
        setSequenceMessage(
          `Sequence wrote clear ${result.clear.bytesHex} then amount ${result.amount.bytesHex}. “OK” means writes completed — not that the panel rendered correctly.`
        )
      }
    } finally {
      refresh()
      setBusy(false)
    }
  }, [canUseDiagnostics, diagnosticMode, sequenceAmountInput, refresh])

  const cashierStatusLabel = useMemo(() => {
    if (status === "connected") return "Customer display: Connected"
    if (status === "error") return "Customer display: Error"
    return "Customer display: Off"
  }, [status])

  const statusLabel = useMemo(() => {
    if (status === "connected") {
      if (diagnosticMode) {
        return `Customer display: Connected · diagnostic · ${baudRate ?? "—"} baud`
      }
      if (!autoUpdatesAllowed) {
        return `Customer display: Connected · setup · ${baudRate ?? "—"} baud`
      }
      return "Customer display: Connected"
    }
    if (status === "error") return "Customer display: Error"
    return "Customer display: Off"
  }, [status, diagnosticMode, baudRate, autoUpdatesAllowed])

  const pendingTest = useMemo(() => getCustomerDisplayDiagnosticTest(pendingTestId), [pendingTestId])
  const hasTerminalBinding = Boolean(terminalIdentity?.registerId)

  return {
    status,
    cashierStatusLabel,
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
    advancedOpen,
    setAdvancedOpen,
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
    sequenceAmountInput,
    setSequenceAmountInput,
    clearThenAmountPreview,
    runClearThenAmount,
    sequenceMessage,
    clearThenAmountWarning: CANDIDATE_CLEAR_THEN_AMOUNT_WARNING,
    diagnosticLog,
    baudRate,
    terminalConfig,
    autoUpdatesAllowed,
    hasTerminalBinding,
    markPhysicallyVerified,
    clearPhysicalVerification,
    configMessage,
    selectedProfile,
  }
}
