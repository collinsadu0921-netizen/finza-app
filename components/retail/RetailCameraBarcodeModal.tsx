"use client"

import { useCallback, useEffect, useRef, useState } from "react"

type Phase = "idle" | "starting" | "scanning" | "denied" | "unsupported" | "error"

export type RetailCameraBarcodeModalProps = {
  open: boolean
  onClose: () => void
  /** Trimmed barcode string; parent updates a field (forms) or runs POS resolution. */
  onCode: (code: string) => void | Promise<void>
  /** Dialog title (POS default: “Scan with camera”). */
  title?: string
  /** Shown while scanning; same UX as POS when omitted. */
  scanningFooterHint?: string
}

const DEDUPE_MS = 1800

/** Common retail symbologies; BarcodeDetector ignores unknown entries on some engines. */
const BARCODE_DETECTOR_FORMATS: string[] = [
  "aztec",
  "code_128",
  "code_39",
  "code_93",
  "codabar",
  "data_matrix",
  "ean_13",
  "ean_8",
  "itf",
  "pdf417",
  "qr_code",
  "upc_a",
  "upc_e",
]

function stopStream(stream: MediaStream | null) {
  if (!stream) return
  for (const t of stream.getTracks()) {
    try {
      t.stop()
    } catch {
      /* ignore */
    }
  }
}

export default function RetailCameraBarcodeModal({
  open,
  onClose,
  onCode,
  title = "Scan with camera",
  scanningFooterHint = "Point at a barcode. Hold steady — we ignore duplicate reads for a moment after each scan.",
}: RetailCameraBarcodeModalProps) {
  const onCodeRef = useRef(onCode)
  const onCloseRef = useRef(onClose)
  onCodeRef.current = onCode
  onCloseRef.current = onClose

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const zxingReaderRef = useRef<import("@zxing/browser").BrowserMultiFormatReader | null>(null)
  const closedRef = useRef(false)

  const [phase, setPhase] = useState<Phase>("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const clearScanLoop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    try {
      const r = zxingReaderRef.current as unknown as { reset?: () => void } | null
      r?.reset?.()
    } catch {
      /* ignore */
    }
    zxingReaderRef.current = null
  }, [])

  const detachVideo = useCallback(() => {
    const v = videoRef.current
    if (v) {
      v.pause()
      v.srcObject = null
    }
    stopStream(streamRef.current)
    streamRef.current = null
  }, [])

  const fullStop = useCallback(() => {
    clearScanLoop()
    detachVideo()
  }, [clearScanLoop, detachVideo])

  const lastAcceptedRef = useRef<{ text: string; at: number }>({ text: "", at: 0 })

  const acceptCode = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text) return

      const now = Date.now()
      if (text === lastAcceptedRef.current.text && now - lastAcceptedRef.current.at < DEDUPE_MS) {
        return
      }
      lastAcceptedRef.current = { text, at: now }

      fullStop()
      try {
        await onCodeRef.current(text)
      } finally {
        onCloseRef.current()
      }
    },
    [fullStop]
  )

  useEffect(() => {
    if (!open) {
      fullStop()
      setPhase("idle")
      setErrorMessage(null)
      return
    }

    closedRef.current = false

    if (typeof window === "undefined") return

    if (!window.isSecureContext) {
      setPhase("unsupported")
      setErrorMessage("Camera scanning needs a secure (HTTPS) page.")
      return
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase("unsupported")
      setErrorMessage("This browser does not support camera access from a web page.")
      return
    }

    let cancelled = false

    ;(async () => {
      setPhase("starting")
      setErrorMessage(null)
      lastAcceptedRef.current = { text: "", at: 0 }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        })

        if (cancelled || closedRef.current) {
          stopStream(stream)
          return
        }

        streamRef.current = stream
        const video = videoRef.current
        if (!video) {
          stopStream(stream)
          return
        }

        video.srcObject = stream
        try {
          await video.play()
        } catch {
          stopStream(stream)
          streamRef.current = null
          setPhase("error")
          setErrorMessage("Could not start the camera preview. Try closing other apps using the camera, then try again.")
          return
        }
        if (cancelled || closedRef.current) {
          fullStop()
          return
        }

        setPhase("scanning")

        const runBarcodeDetectorLoop = () => {
          const BD = (window as unknown as {
            BarcodeDetector?: new (opts?: { formats?: string[] }) => {
              detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>
            }
          }).BarcodeDetector
          if (!BD) return false

          let detector: InstanceType<typeof BD>
          try {
            detector = new BD({ formats: BARCODE_DETECTOR_FORMATS })
          } catch {
            try {
              detector = new BD()
            } catch {
              return false
            }
          }

          intervalRef.current = setInterval(async () => {
            if (cancelled || closedRef.current || !videoRef.current) return
            const v = videoRef.current
            if (v.readyState < 2) return
            try {
              const codes = await detector.detect(v)
              for (const c of codes) {
                const val = c.rawValue?.trim()
                if (val) {
                  void acceptCode(val)
                  return
                }
              }
            } catch {
              /* empty frame / transient */
            }
          }, 220)
          return true
        }

        if (runBarcodeDetectorLoop()) {
          return
        }

        const { BrowserMultiFormatReader } = await import("@zxing/browser")
        const reader = new BrowserMultiFormatReader()
        zxingReaderRef.current = reader

        intervalRef.current = setInterval(async () => {
          if (cancelled || closedRef.current || !videoRef.current) return
          const v = videoRef.current
          if (v.readyState < 2) return
          try {
            const result = await reader.decodeOnceFromVideoElement(v)
            const text = result.getText()?.trim()
            if (text) void acceptCode(text)
          } catch (e: unknown) {
            if (e && typeof e === "object" && "name" in e && (e as { name: string }).name === "NotFoundException") {
              return
            }
            /* ignore transient decode errors */
          }
        }, 280)
      } catch (e: unknown) {
        const err = e as { name?: string; message?: string }
        if (err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError") {
          setPhase("denied")
          setErrorMessage(
            "Camera permission was denied. Use the search box or a USB/Bluetooth scanner, or allow camera in browser settings."
          )
        } else if (err?.name === "NotFoundError" || err?.name === "DevicesNotFoundError") {
          setPhase("unsupported")
          setErrorMessage("No usable camera was found on this device.")
        } else {
          setPhase("error")
          setErrorMessage(err?.message || "Could not start the camera.")
        }
      }
    })()

    return () => {
      cancelled = true
      closedRef.current = true
      fullStop()
    }
  }, [open, fullStop, acceptCode])

  useEffect(() => {
    return () => {
      closedRef.current = true
      fullStop()
    }
  }, [fullStop])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/95 text-white"
      role="dialog"
      aria-modal="true"
      aria-labelledby="retail-camera-barcode-modal-title"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3 py-[max(0.5rem,env(safe-area-inset-top))]">
        <h2 id="retail-camera-barcode-modal-title" className="text-sm font-extrabold tracking-tight">
          {title}
        </h2>
        <button
          type="button"
          onClick={() => {
            fullStop()
            onClose()
          }}
          className="min-h-[44px] min-w-[44px] touch-manipulation rounded-lg border border-white/20 bg-white/10 px-3 text-sm font-bold hover:bg-white/20"
        >
          Close
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        {phase === "starting" && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/80 px-4 text-center">
            <div className="h-9 w-9 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden />
            <p className="text-sm font-medium text-white/90">Starting camera…</p>
          </div>
        )}

        {(phase === "denied" || phase === "unsupported" || phase === "error") && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 overflow-y-auto bg-black/90 px-4 text-center">
            <p className="max-w-sm text-sm leading-relaxed text-white/90">{errorMessage}</p>
            <p className="max-w-sm text-xs leading-relaxed text-white/70">
              Use the search box above or a Bluetooth/USB barcode scanner if camera scanning is unavailable.
            </p>
            <button
              type="button"
              onClick={() => {
                fullStop()
                onClose()
              }}
              className="min-h-[48px] rounded-xl bg-white px-5 text-sm font-extrabold text-slate-900"
            >
              OK
            </button>
          </div>
        )}

        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          playsInline
          muted
          autoPlay
        />
      </div>

      {phase === "scanning" && (
        <p className="shrink-0 border-t border-white/10 px-3 py-2 text-center text-[11px] leading-snug text-white/75">
          {scanningFooterHint}
        </p>
      )}
    </div>
  )
}
