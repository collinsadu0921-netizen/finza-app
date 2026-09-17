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
  CLEAR_THEN_AMOUNT_CANDIDATE_WARNING,
  CLEAR_THEN_AMOUNT_REQUIRED_PROFILE_ID,
  canSelectClearThenAmountWriteMode,
  defaultCustomerDisplayTerminalConfig,
  formatVerifiedDisplayNote,
  readCustomerDisplayTerminalConfig,
  resolveConnectSerialProfile,
  resolveCustomerDisplayAmountWriteMode,
  writeCustomerDisplayTerminalConfig,
  type CustomerDisplayAmountWriteMode,
  type CustomerDisplayTerminalConfig,
  type CustomerDisplayTerminalIdentity,
} from "@/lib/retail/hardware/customerDisplayTerminalConfig"
import {
  LIVE_TRIAL_REQUIRED_PROFILE_ID,
  LIVE_TRIAL_UI_WARNING,
  canStartCustomerDisplayLiveTrial,
} from "@/lib/retail/hardware/customerDisplayLiveTrial"
import {
  customerDisplayIdentityKey,
  formatCustomerDisplayOpenError,
  nextCustomerDisplayLoadState,
  resolveAmountWriteModeFromServerSources,
  resolveCashierReadyLabel,
  resolveCustomerDisplayConnectAvailability,
  resolveOwnerTerminalDraft,
  shouldAllowAutomaticUpdatesFromServerSources,
  shouldCloseCustomerDisplayOnLifecycleChange,
  shouldFetchRegisterCustomerDisplayConfig,
  type CashierRegisterCustomerDisplayView,
  type RegisterCustomerDisplayConfig,
} from "@/lib/retail/hardware/registerCustomerDisplayConfig"
import { getCashierPosToken } from "@/lib/cashierSession"
import { getWebSerial } from "@/lib/retail/hardware/webSerialPort"
import {
  connectCustomerDisplay,
  disconnectCustomerDisplay,
  getCustomerDisplayBaudRate,
  getCustomerDisplayLastError,
  getCustomerDisplayStatus,
  isCustomerDisplayDiagnosticMode,
  isCustomerDisplaySessionConnected,
  listCustomerDisplayDiagnosticLog,
  reconnectCustomerDisplayWithProfile,
  setAutomaticCustomerDisplaySaleWritesEnabled,
  setCustomerDisplayAmountWriteMode,
  setCustomerDisplayDiagnosticMode,
  setCustomerDisplayLiveTrialWritesEnabled,
  writeCustomerDisplayAmount,
  writeCustomerDisplayDiagnosticClearThenAmount,
  writeCustomerDisplayDiagnosticTest,
  writeCustomerDisplayLiveTrialAmount,
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
  /** Primitive key — do not put the identity object itself in effect deps. */
  const identityKey = customerDisplayIdentityKey(terminalIdentity)

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
  /** Session-only; defaults off and is never restored from localStorage / physicallyVerified. */
  const [liveTrialActive, setLiveTrialActive] = useState(false)
  const [liveTrialMessage, setLiveTrialMessage] = useState("")
  const [serverConfig, setServerConfig] = useState<RegisterCustomerDisplayConfig | null>(null)
  const [serverView, setServerView] = useState<CashierRegisterCustomerDisplayView | null>(null)
  const [configLoadState, setConfigLoadState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle"
  )
  const [everConnectedThisSession, setEverConnectedThisSession] = useState(false)
  const [needsPortPermissionHint, setNeedsPortPermissionHint] = useState(false)
  const [localImportCandidate, setLocalImportCandidate] =
    useState<CustomerDisplayTerminalConfig | null>(null)
  /** Stop auto writes after a serial failure until the cashier reconnects. */
  const [autoWritesPausedAfterError, setAutoWritesPausedAfterError] = useState(false)
  const idleTimerRef = useRef<number | null>(null)
  const fetchedIdentityKeyRef = useRef<string | null>(null)
  const prevIdentityKeyRef = useRef<string | null>(null)
  const configLoadStateRef = useRef(configLoadState)
  configLoadStateRef.current = configLoadState
  const [connectionPhase, setConnectionPhase] = useState<
    "idle" | "connecting" | "disconnecting"
  >("idle")
  /** After Connect, skip auto-writes until cart/checkout/sale state actually changes. */
  const skipAutoWriteUntilChangeRef = useRef<{
    cartCount: number
    runningTotal: number
    checkoutOpen: boolean
    saleSuccess: CustomerDisplaySaleSuccess
  } | null>(null)
  const cartSnapshotRef = useRef({
    cartCount: opts.cartCount,
    runningTotal: opts.runningTotal,
    checkoutOpen: opts.checkoutOpen,
    saleSuccess: opts.saleSuccess,
  })
  cartSnapshotRef.current = {
    cartCount: opts.cartCount,
    runningTotal: opts.runningTotal,
    checkoutOpen: opts.checkoutOpen,
    saleSuccess: opts.saleSuccess,
  }

  const applyServerPayload = useCallback(
    (payload: {
      config?: RegisterCustomerDisplayConfig
      view?: CashierRegisterCustomerDisplayView
    }) => {
      if (payload.config) {
        setServerConfig(payload.config)
      }
      if (payload.view) setServerView(payload.view)
    },
    []
  )

  const syncOwnerDraftFromSources = useCallback(
    (
      nextServer: RegisterCustomerDisplayConfig | null,
      loadState: "idle" | "loading" | "ready" | "error"
    ) => {
      const local = readCustomerDisplayTerminalConfig(terminalIdentity)
      const resolved = resolveOwnerTerminalDraft({
        serverConfig: nextServer,
        local,
        serverLoadState: loadState,
      })
      setTerminalConfig(resolved.terminalConfig)
      setProfileId(resolved.terminalConfig.profileId)

      if (
        canUseDiagnostics &&
        local?.physicallyVerified === true &&
        (!nextServer?.physicallyVerified || !nextServer?.configured)
      ) {
        setLocalImportCandidate(local)
      } else {
        setLocalImportCandidate(null)
      }
    },
    [terminalIdentity, canUseDiagnostics]
  )

  const reloadServerConfig = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!identityKey || !terminalIdentity?.registerId) {
        fetchedIdentityKeyRef.current = null
        setServerConfig(null)
        setServerView(null)
        setConfigLoadState("idle")
        setLocalImportCandidate(null)
        return null
      }

      if (
        !opts?.force &&
        !shouldFetchRegisterCustomerDisplayConfig(fetchedIdentityKeyRef.current, identityKey)
      ) {
        return null
      }

      const previousLoad = configLoadStateRef.current
      setConfigLoadState(nextCustomerDisplayLoadState({ previous: previousLoad, phase: "start" }))

      try {
        const posToken = getCashierPosToken()
        const headers: HeadersInit = posToken ? { Authorization: `Bearer ${posToken}` } : {}
        const res = await fetch(
          `/api/retail/registers/${encodeURIComponent(terminalIdentity.registerId)}/customer-display`,
          { headers, cache: "no-store" }
        )
        if (!res.ok) {
          setConfigLoadState(
            nextCustomerDisplayLoadState({ previous: previousLoad, phase: "failure" })
          )
          setConfigMessage("Could not load customer display settings for this register.")
          return null
        }
        const payload = (await res.json()) as {
          config?: RegisterCustomerDisplayConfig
          view?: CashierRegisterCustomerDisplayView
        }
        applyServerPayload(payload)
        fetchedIdentityKeyRef.current = identityKey
        const readyState = nextCustomerDisplayLoadState({
          previous: previousLoad,
          phase: "success",
        })
        setConfigLoadState(readyState)
        syncOwnerDraftFromSources(payload.config ?? null, readyState)
        return payload
      } catch {
        setConfigLoadState(
          nextCustomerDisplayLoadState({ previous: previousLoad, phase: "failure" })
        )
        return null
      }
    },
    [identityKey, terminalIdentity?.registerId, applyServerPayload, syncOwnerDraftFromSources]
  )

  const refresh = useCallback(() => {
    setStatus(getCustomerDisplayStatus())
    setLastError(getCustomerDisplayLastError())
    setBaudRate(getCustomerDisplayBaudRate())
    setDiagnosticMode(isCustomerDisplayDiagnosticMode())
    setDiagnosticLog(listCustomerDisplayDiagnosticLog())
  }, [])

  // Fetch once per bound register identity key — not when parent recreates the identity object.
  useEffect(() => {
    void reloadServerConfig()
  }, [identityKey, reloadServerConfig])

  /**
   * Shared serial session lives in retailPosHardware module (tab-scoped).
   * Close only when the bound register identity changes — never on owner↔cashier role flips.
   */
  useEffect(() => {
    const previous = prevIdentityKeyRef.current
    const action = shouldCloseCustomerDisplayOnLifecycleChange({
      previousIdentityKey: previous,
      nextIdentityKey: identityKey,
    })
    prevIdentityKeyRef.current = identityKey

    if (action === "close_identity_changed" || action === "clear_unbound") {
      skipAutoWriteUntilChangeRef.current = null
      setAutoWritesPausedAfterError(false)
      setEverConnectedThisSession(false)
      setConnectionPhase("disconnecting")
      void disconnectCustomerDisplay().finally(() => {
        setConnectionPhase("idle")
        refresh()
      })
      return
    }

    // Role change or first mount with same register: retain module session and sync UI.
    if (isCustomerDisplaySessionConnected()) {
      setEverConnectedThisSession(true)
      skipAutoWriteUntilChangeRef.current = { ...cartSnapshotRef.current }
      setAutoWritesPausedAfterError(false)
    }
    refresh()
  }, [identityKey, refresh])

  // Permissions/UI only — never close the shared serial port when role changes.
  useEffect(() => {
    if (isCustomerDisplaySessionConnected()) {
      setEverConnectedThisSession(true)
      skipAutoWriteUntilChangeRef.current = { ...cartSnapshotRef.current }
    }
    refresh()
  }, [canUseDiagnostics, refresh])

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

  const autoUpdatesAllowed =
    shouldAllowAutomaticUpdatesFromServerSources({
      serverConfig,
      serverView,
    }) && !autoWritesPausedAfterError
  const amountWriteMode = resolveAmountWriteModeFromServerSources({
    serverConfig,
    serverView,
    fallbackProfileId: profileId,
    fallbackMode: terminalConfig.amountWriteMode,
  })

  useEffect(() => {
    setAutomaticCustomerDisplaySaleWritesEnabled(autoUpdatesAllowed)
    return () => {
      setAutomaticCustomerDisplaySaleWritesEnabled(false)
    }
  }, [autoUpdatesAllowed])

  useEffect(() => {
    setCustomerDisplayAmountWriteMode(amountWriteMode)
    return () => {
      setCustomerDisplayAmountWriteMode("ascii_only")
    }
  }, [amountWriteMode])

  useEffect(() => {
    setCustomerDisplayLiveTrialWritesEnabled(liveTrialActive)
    return () => {
      setCustomerDisplayLiveTrialWritesEnabled(false)
    }
  }, [liveTrialActive])

  const stopLiveTrial = useCallback((message?: string) => {
    setLiveTrialActive(false)
    setCustomerDisplayLiveTrialWritesEnabled(false)
    if (message) setLiveTrialMessage(message)
  }, [])

  useEffect(() => {
    const baseline = skipAutoWriteUntilChangeRef.current
    if (baseline) {
      const unchanged =
        baseline.cartCount === opts.cartCount &&
        baseline.runningTotal === opts.runningTotal &&
        baseline.checkoutOpen === opts.checkoutOpen &&
        baseline.saleSuccess === opts.saleSuccess
      if (unchanged) {
        return
      }
      skipAutoWriteUntilChangeRef.current = null
    }

    const intent = resolveCustomerDisplayIntent({
      status,
      cartCount: opts.cartCount,
      runningTotal: opts.runningTotal,
      checkoutOpen: opts.checkoutOpen,
      saleSuccess: opts.saleSuccess,
      diagnosticMode,
      // Verified auto-sale gate stays fail-closed; live trial uses a separate path below.
      autoUpdatesAllowed: liveTrialActive ? false : autoUpdatesAllowed,
    })

    const runVerifiedAuto = async () => {
      try {
        clearIdleTimer()
        if (liveTrialActive) return
        if (intent.action === "none") return
        const result = await writeCustomerDisplayAmount(intent.amount)
        if (result && result.ok === false) {
          setAutoWritesPausedAfterError(true)
          setAutomaticCustomerDisplaySaleWritesEnabled(false)
          setLastError(result.error || "Customer display write failed.")
          setStatus("error")
          return
        }
        if (intent.action === "writeThenIdle") {
          idleTimerRef.current = window.setTimeout(() => {
            void writeCustomerDisplayAmount(0).then((idleResult) => {
              if (idleResult && idleResult.ok === false) {
                setAutoWritesPausedAfterError(true)
                setAutomaticCustomerDisplaySaleWritesEnabled(false)
                setLastError(idleResult.error || "Customer display write failed.")
                setStatus("error")
                return
              }
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

    const runLiveTrial = async () => {
      try {
        clearIdleTimer()
        if (!liveTrialActive || diagnosticMode) return
        const trialIntent = resolveCustomerDisplayIntent({
          status,
          cartCount: opts.cartCount,
          runningTotal: opts.runningTotal,
          checkoutOpen: opts.checkoutOpen,
          saleSuccess: opts.saleSuccess,
          diagnosticMode: false,
          autoUpdatesAllowed: true,
        })
        if (trialIntent.action === "none") return

        const writeOnce = async (amount: number) => {
          const result = await writeCustomerDisplayLiveTrialAmount(amount)
          if (result.superseded) return true
          if (!result.ok) {
            stopLiveTrial(
              `Live trial stopped: display write failed (${result.error || "unknown"}). Sale continues.`
            )
            setLastError(result.error || "Customer display write failed.")
            return false
          }
          return true
        }

        const ok = await writeOnce(trialIntent.amount)
        if (!ok) return
        if (trialIntent.action === "writeThenIdle") {
          idleTimerRef.current = window.setTimeout(() => {
            void writeOnce(0).then(() => {
              setStatus(getCustomerDisplayStatus())
              setLastError(getCustomerDisplayLastError())
            })
          }, trialIntent.idleAfterMs)
        }
      } catch {
        /* Display must never block the sale */
      } finally {
        setStatus(getCustomerDisplayStatus())
        setLastError(getCustomerDisplayLastError())
      }
    }

    if (liveTrialActive) {
      void runLiveTrial()
    } else {
      void runVerifiedAuto()
    }
    return () => {
      clearIdleTimer()
    }
  }, [
    status,
    diagnosticMode,
    autoUpdatesAllowed,
    liveTrialActive,
    opts.cartCount,
    opts.runningTotal,
    opts.checkoutOpen,
    opts.saleSuccess,
    opts.saleSuccess?.cashReceived,
    opts.saleSuccess?.changeGiven,
    clearIdleTimer,
    stopLiveTrial,
  ])

  const selectedProfile = useMemo(() => getCustomerDisplaySerialProfile(profileId), [profileId])

  const connect = useCallback(
    async (opts?: { forcePortPicker?: boolean }) => {
      setBusy(true)
      setConnectionPhase("connecting")
      setConfigMessage("")
      let connectError: string | null = null
      try {
        // Already connected for this till — reuse; do not reopen or pick another port.
        if (isCustomerDisplaySessionConnected() && opts?.forcePortPicker !== true) {
          setEverConnectedThisSession(true)
          setAutoWritesPausedAfterError(false)
          skipAutoWriteUntilChangeRef.current = { ...cartSnapshotRef.current }
          setLastError("")
          return
        }

        const diagnostic = canUseDiagnostics && diagnosticMode
        const profile = canUseDiagnostics
          ? resolveConnectSerialProfile(terminalConfig, {
              diagnosticMode: diagnostic,
              diagnosticProfileId: profileId,
            }) ?? getCustomerDisplaySerialProfile(profileId)
          : serverView?.setupStatus === "ready" && serverView.connectProfile
            ? resolveConnectSerialProfile({
                profileId: serverView.connectProfile.profileId,
                physicallyVerified: true,
                verifiedAt: null,
                verifiedNote: null,
                amountWriteMode: serverView.connectProfile.amountWriteMode,
                updatedAt: new Date(0).toISOString(),
              })
            : null

        if (!profile) {
          connectError =
            "Customer display requires owner/admin setup. Sales can continue without it."
          setNeedsPortPermissionHint(false)
          return
        }

        await connectCustomerDisplay({
          profile,
          diagnosticMode: diagnostic,
          forcePortPicker: opts?.forcePortPicker === true,
          identityKey,
        })
        setEverConnectedThisSession(true)
        setNeedsPortPermissionHint(false)
        setAutoWritesPausedAfterError(false)
        // Connect itself must not send bytes — wait for a genuine basket/checkout change.
        skipAutoWriteUntilChangeRef.current = { ...cartSnapshotRef.current }
        setLastError("")
      } catch (e: unknown) {
        connectError = formatCustomerDisplayOpenError(e)
        if (/permission|select|serial|NotFound|Security|already in use/i.test(connectError)) {
          setNeedsPortPermissionHint(true)
        }
      } finally {
        setStatus(getCustomerDisplayStatus())
        setBaudRate(getCustomerDisplayBaudRate())
        setDiagnosticMode(isCustomerDisplayDiagnosticMode())
        setDiagnosticLog(listCustomerDisplayDiagnosticLog())
        if (connectError) {
          setLastError(connectError)
          if (getCustomerDisplayStatus() !== "connected") {
            setStatus("error")
          }
        } else if (!connectError) {
          setLastError(getCustomerDisplayLastError())
        }
        setConnectionPhase("idle")
        setBusy(false)
      }
    },
    [
      canUseDiagnostics,
      diagnosticMode,
      profileId,
      terminalConfig,
      serverView,
      identityKey,
    ]
  )

  const chooseSerialDevice = useCallback(async () => {
    await connect({ forcePortPicker: true })
  }, [connect])

  const disconnect = useCallback(async () => {
    setBusy(true)
    setConnectionPhase("disconnecting")
    try {
      stopLiveTrial(
        "Live trial stopped on disconnect. Digits already on the panel are not cleared by Disconnect."
      )
      skipAutoWriteUntilChangeRef.current = null
      await disconnectCustomerDisplay()
    } finally {
      refresh()
      setConnectionPhase("idle")
      setBusy(false)
    }
  }, [refresh, stopLiveTrial])

  const persistConfigToServer = useCallback(
    async (input: {
      profileId: CustomerDisplaySerialProfile["id"]
      amountWriteMode: CustomerDisplayAmountWriteMode
      markVerified?: boolean
      clearVerification?: boolean
      verifiedNote?: string | null
    }) => {
      if (!canUseDiagnostics || !terminalIdentity?.registerId) {
        setConfigMessage(
          terminalIdentity
            ? "Only owner/admin can save register display settings."
            : "Bind this till to a register before saving a display profile."
        )
        return false
      }
      try {
        const posToken = getCashierPosToken()
        const res = await fetch(
          `/api/retail/registers/${encodeURIComponent(terminalIdentity.registerId)}/customer-display`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              ...(posToken ? { Authorization: `Bearer ${posToken}` } : {}),
            },
            body: JSON.stringify({
              profileId: input.profileId,
              amountWriteMode: input.amountWriteMode,
              markVerified: input.markVerified === true,
              clearVerification: input.clearVerification === true,
              verifiedNote: input.verifiedNote ?? null,
              storeId: terminalIdentity.storeId,
              enabled: true,
            }),
          }
        )
        const payload = (await res.json()) as {
          error?: string
          config?: RegisterCustomerDisplayConfig
          view?: CashierRegisterCustomerDisplayView
        }
        if (!res.ok) {
          setConfigMessage(payload.error || "Could not save register display settings.")
          return false
        }
        applyServerPayload(payload)
        syncOwnerDraftFromSources(payload.config ?? null, "ready")
        setConfigLoadState("ready")
        // Keep a local mirror for this till’s diagnostic draft / migration history only.
        if (payload.config?.profileId) {
          writeCustomerDisplayTerminalConfig(terminalIdentity, {
            profileId: payload.config.profileId,
            physicallyVerified: payload.config.physicallyVerified,
            verifiedAt: payload.config.verifiedAt,
            verifiedNote: payload.config.verifiedNote,
            amountWriteMode: payload.config.amountWriteMode ?? "ascii_only",
            updatedAt: payload.config.updatedAt ?? new Date().toISOString(),
          })
        }
        return true
      } catch {
        setConfigMessage("Could not save register display settings.")
        return false
      }
    },
    [canUseDiagnostics, terminalIdentity, applyServerPayload, syncOwnerDraftFromSources]
  )

  const persistConfig = useCallback(
    (next: CustomerDisplayTerminalConfig) => {
      // Local draft only — automatic totals follow server verification.
      writeCustomerDisplayTerminalConfig(terminalIdentity, next)
      setTerminalConfig(next)
      setProfileId(next.profileId)
      return true
    },
    [terminalIdentity]
  )

  const saveCandidateProfile = useCallback(
    (nextId: CustomerDisplaySerialProfile["id"]) => {
      if (!canUseDiagnostics) return
      const nextMode: CustomerDisplayAmountWriteMode = canSelectClearThenAmountWriteMode(nextId)
        ? terminalConfig.amountWriteMode === "clear_then_amount"
          ? "clear_then_amount"
          : "ascii_only"
        : "ascii_only"
      const next: CustomerDisplayTerminalConfig = {
        ...terminalConfig,
        profileId: nextId,
        amountWriteMode: nextMode,
        physicallyVerified: false,
        verifiedAt: null,
        verifiedNote: null,
        updatedAt: new Date().toISOString(),
      }
      persistConfig(next)
      setProfileId(nextId)
      void persistConfigToServer({
        profileId: nextId,
        amountWriteMode: nextMode,
        clearVerification: true,
      }).then((ok) => {
        if (ok) {
          setConfigMessage(
            "Saved serial profile on this register. Physical verification cleared — automatic totals stay off."
          )
        }
      })
    },
    [canUseDiagnostics, terminalConfig, persistConfig, persistConfigToServer]
  )

  const saveAmountWriteMode = useCallback(
    (mode: CustomerDisplayAmountWriteMode) => {
      if (!canUseDiagnostics) return
      if (mode === "clear_then_amount" && !canSelectClearThenAmountWriteMode(profileId)) {
        setConfigMessage("Clear-then-amount candidate requires the 2400 baud profile on this till.")
        return
      }
      const next: CustomerDisplayTerminalConfig = {
        ...terminalConfig,
        profileId,
        amountWriteMode: mode,
        physicallyVerified: false,
        verifiedAt: null,
        verifiedNote: null,
        updatedAt: new Date().toISOString(),
      }
      persistConfig(next)
      void persistConfigToServer({
        profileId,
        amountWriteMode: mode,
        clearVerification: true,
      }).then((ok) => {
        if (ok) {
          setConfigMessage(
            mode === "clear_then_amount"
              ? "Saved staging candidate on this register: clear then amount (0C). Automatic totals stay off until verified."
              : "Saved plain ASCII amount writes on this register. Automatic totals stay off until verified."
          )
        }
      })
    },
    [canUseDiagnostics, terminalConfig, profileId, persistConfig, persistConfigToServer]
  )

  const markPhysicallyVerified = useCallback(() => {
    if (!canUseDiagnostics) return
    const mode = resolveCustomerDisplayAmountWriteMode({
      ...terminalConfig,
      profileId,
    })
    const note = formatVerifiedDisplayNote(profileId, mode)
    const next: CustomerDisplayTerminalConfig = {
      ...terminalConfig,
      profileId,
      amountWriteMode: mode,
      physicallyVerified: true,
      verifiedAt: new Date().toISOString(),
      verifiedNote: note,
      updatedAt: new Date().toISOString(),
    }
    persistConfig(next)
    void persistConfigToServer({
      profileId,
      amountWriteMode: mode,
      markVerified: true,
      verifiedNote: note,
    }).then((ok) => {
      if (ok) {
        setLocalImportCandidate(null)
        setConfigMessage(
          "Saved as physically verified on this register. Automatic basket totals may resume when connected."
        )
      }
    })
  }, [canUseDiagnostics, terminalConfig, profileId, persistConfig, persistConfigToServer])

  const clearPhysicalVerification = useCallback(() => {
    if (!canUseDiagnostics) return
    const next: CustomerDisplayTerminalConfig = {
      ...terminalConfig,
      physicallyVerified: false,
      verifiedAt: null,
      verifiedNote: null,
      updatedAt: new Date().toISOString(),
    }
    persistConfig(next)
    void persistConfigToServer({
      profileId,
      amountWriteMode: resolveCustomerDisplayAmountWriteMode({ ...terminalConfig, profileId }),
      clearVerification: true,
    }).then((ok) => {
      if (ok) {
        setConfigMessage("Automatic basket totals disabled until this register is re-verified.")
      }
    })
  }, [canUseDiagnostics, terminalConfig, profileId, persistConfig, persistConfigToServer])

  const confirmLocalImport = useCallback(async () => {
    if (!canUseDiagnostics || !terminalIdentity?.registerId || !localImportCandidate) return
    try {
      const posToken = getCashierPosToken()
      const res = await fetch(
        `/api/retail/registers/${encodeURIComponent(terminalIdentity.registerId)}/customer-display`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...(posToken ? { Authorization: `Bearer ${posToken}` } : {}),
          },
          body: JSON.stringify({
            confirmLocalImport: true,
            storeId: terminalIdentity.storeId,
            local: {
              profileId: localImportCandidate.profileId,
              amountWriteMode: localImportCandidate.amountWriteMode,
              verifiedNote: localImportCandidate.verifiedNote,
            },
          }),
        }
      )
      const payload = (await res.json()) as {
        error?: string
        config?: RegisterCustomerDisplayConfig
        view?: CashierRegisterCustomerDisplayView
      }
      if (!res.ok) {
        setConfigMessage(payload.error || "Could not confirm local profile.")
        return
      }
      applyServerPayload(payload)
      syncOwnerDraftFromSources(payload.config ?? null, "ready")
      setConfigLoadState("ready")
      setLocalImportCandidate(null)
      setConfigMessage(
        "Confirmed this till’s browser profile on the register. Cashiers can connect using the server settings."
      )
    } catch {
      setConfigMessage("Could not confirm local profile.")
    }
  }, [
    canUseDiagnostics,
    terminalIdentity,
    localImportCandidate,
    applyServerPayload,
    syncOwnerDraftFromSources,
  ])

  const enableDiagnostics = useCallback(async () => {
    if (!canUseDiagnostics) return
    stopLiveTrial("Live trial stopped while entering diagnostic mode.")
    setDiagnosticMode(true)
    setAdvancedOpen(true)
    await setCustomerDisplayDiagnosticMode(true)
    clearIdleTimer()
    refresh()
  }, [canUseDiagnostics, clearIdleTimer, refresh, stopLiveTrial])

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

  const setupStatus = serverView?.setupStatus ?? ("not_configured" as const)

  const cashierStatusLabel = useMemo(() => {
    if (connectionPhase === "connecting") return "Customer display: Connecting"
    if (connectionPhase === "disconnecting") return "Customer display: Disconnecting"
    if (configLoadState === "loading") return "Customer display: …"
    if (setupStatus === "not_configured" || setupStatus === "unverified") {
      return "Customer display: Not configured"
    }
    if (status === "connected") return "Customer display: Connected"
    if (status === "error") return "Customer display: Error"
    if (everConnectedThisSession) return "Customer display: Disconnected"
    return resolveCashierReadyLabel({
      setupStatus: "ready",
      connectionStatus: "disconnected",
    })
  }, [connectionPhase, configLoadState, setupStatus, status, everConnectedThisSession])

  const hasTerminalBinding = Boolean(identityKey)
  const webSerialSupported = typeof window === "undefined" ? true : Boolean(getWebSerial())
  const connectAvailability = resolveCustomerDisplayConnectAvailability({
    canUseDiagnostics,
    hasTerminalBinding,
    configLoadState,
    setupStatus: configLoadState === "ready" || configLoadState === "error" ? setupStatus : null,
    webSerialSupported,
  })
  const canCashierConnect = connectAvailability.canConnect
  const connectDisabledReason = connectAvailability.reason
  const cashierSetupMessage =
    !canUseDiagnostics && (setupStatus === "not_configured" || setupStatus === "unverified")
      ? serverView?.message ||
        "Customer display requires owner/admin setup. Sales can continue without it."
      : null

  const liveTrialStartGate = useMemo(
    () =>
      canStartCustomerDisplayLiveTrial({
        canUseDiagnostics,
        hasTerminalBinding,
        status,
        profileId,
        connectedBaudRate: baudRate,
        diagnosticMode,
      }),
    [canUseDiagnostics, hasTerminalBinding, status, profileId, baudRate, diagnosticMode]
  )

  const startLiveTrial = useCallback(() => {
    if (!canUseDiagnostics) return
    const gate = canStartCustomerDisplayLiveTrial({
      canUseDiagnostics,
      hasTerminalBinding,
      status: getCustomerDisplayStatus(),
      profileId,
      connectedBaudRate: getCustomerDisplayBaudRate(),
      diagnosticMode: isCustomerDisplayDiagnosticMode(),
    })
    if (!gate.ok) {
      setLiveTrialMessage(gate.reason || "Cannot start live trial.")
      return
    }
    setLiveTrialMessage(
      "Live trial on for this till only. Basket/checkout totals send 0C then ASCII. Not verified / not customer-ready."
    )
    setLiveTrialActive(true)
  }, [canUseDiagnostics, hasTerminalBinding, profileId])

  const statusLabel = useMemo(() => {
    if (connectionPhase === "connecting") return "Customer display: Connecting"
    if (connectionPhase === "disconnecting") return "Customer display: Disconnecting"
    if (status === "connected") {
      if (diagnosticMode) {
        return `Customer display: Connected · diagnostic · ${baudRate ?? "—"} baud`
      }
      if (liveTrialActive) {
        return `Customer display: Connected · live trial · ${baudRate ?? "—"} baud`
      }
      if (!autoUpdatesAllowed) {
        return `Customer display: Connected · setup · ${baudRate ?? "—"} baud`
      }
      return "Customer display: Connected"
    }
    if (status === "error") return "Customer display: Error"
    if (everConnectedThisSession) return "Customer display: Disconnected"
    return "Customer display: Ready to connect"
  }, [
    connectionPhase,
    status,
    diagnosticMode,
    baudRate,
    autoUpdatesAllowed,
    liveTrialActive,
    everConnectedThisSession,
  ])

  const pendingTest = useMemo(() => getCustomerDisplayDiagnosticTest(pendingTestId), [pendingTestId])

  return {
    status,
    cashierStatusLabel,
    statusLabel,
    lastError,
    busy,
    connectionPhase,
    panelOpen,
    setPanelOpen,
    connect: () => void connect(),
    chooseSerialDevice: () => void chooseSerialDevice(),
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
    amountWriteMode,
    amountWriteModeWarning: CLEAR_THEN_AMOUNT_CANDIDATE_WARNING,
    clearThenAmountRequiredProfileId: CLEAR_THEN_AMOUNT_REQUIRED_PROFILE_ID,
    canSelectClearThenAmount: canSelectClearThenAmountWriteMode(profileId),
    saveAmountWriteMode,
    hasTerminalBinding,
    markPhysicallyVerified,
    clearPhysicalVerification,
    configMessage,
    selectedProfile,
    liveTrialActive,
    liveTrialMessage,
    liveTrialWarning: LIVE_TRIAL_UI_WARNING,
    liveTrialRequiredProfileId: LIVE_TRIAL_REQUIRED_PROFILE_ID,
    liveTrialStartGate,
    startLiveTrial,
    stopLiveTrial: () =>
      stopLiveTrial("Live trial stopped. Further automatic writes will not be sent."),
    serverConfig,
    serverView,
    setupStatus,
    cashierSetupMessage,
    canCashierConnect,
    connectDisabledReason,
    needsPortPermissionHint,
    localImportCandidate,
    confirmLocalImport: () => void confirmLocalImport(),
    reloadServerConfig: () => void reloadServerConfig({ force: true }),
  }
}
