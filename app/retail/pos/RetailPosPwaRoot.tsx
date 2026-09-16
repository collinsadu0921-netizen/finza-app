"use client"

import { useEffect, useState } from "react"

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

/**
 * Retail POS PWA install guidance (Chrome/Edge). Does not imply serial permission or offline sales.
 */
export default function RetailPosPwaRoot() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  const [offline, setOffline] = useState(false)
  const [updateReady, setUpdateReady] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return

    const mq = window.matchMedia("(display-mode: standalone)")
    const syncInstalled = () => setInstalled(mq.matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true)
    syncInstalled()
    mq.addEventListener?.("change", syncInstalled)

    const onOnline = () => setOffline(false)
    const onOffline = () => setOffline(true)
    setOffline(!navigator.onLine)
    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)

    const onBip = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    window.addEventListener("beforeinstallprompt", onBip)

    const onInstalled = () => {
      setInstalled(true)
      setDeferred(null)
    }
    window.addEventListener("appinstalled", onInstalled)

    let registration: ServiceWorkerRegistration | null = null
    const register = async () => {
      if (!("serviceWorker" in navigator)) return
      try {
        registration = await navigator.serviceWorker.register("/retail/pos/retail-pos-sw.js", {
          scope: "/retail/pos/",
        })
        registration.addEventListener("updatefound", () => {
          const worker = registration?.installing
          if (!worker) return
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              setUpdateReady(true)
            }
          })
        })
        void registration.update()
      } catch (e) {
        console.warn("[Retail POS SW] registration failed:", e)
      }
    }
    void register()

    return () => {
      mq.removeEventListener?.("change", syncInstalled)
      window.removeEventListener("online", onOnline)
      window.removeEventListener("offline", onOffline)
      window.removeEventListener("beforeinstallprompt", onBip)
      window.removeEventListener("appinstalled", onInstalled)
    }
  }, [])

  const install = async () => {
    if (!deferred) return
    await deferred.prompt()
    await deferred.userChoice
    setDeferred(null)
  }

  const applyUpdate = () => {
    if (!navigator.serviceWorker.controller) {
      window.location.reload()
      return
    }
    navigator.serviceWorker.controller.postMessage({ type: "SKIP_WAITING" })
    window.location.reload()
  }

  return (
    <>
      {offline ? (
        <div className="fixed inset-x-0 top-0 z-[90] bg-amber-900 px-3 py-2 text-center text-xs font-semibold text-white">
          Offline — Finza Retail cannot take sales without a network connection. Reconnect to continue.
        </div>
      ) : null}
      {updateReady ? (
        <div className="fixed inset-x-0 bottom-0 z-[90] flex items-center justify-center gap-2 bg-slate-900 px-3 py-2 text-xs text-white">
          <span>A new Finza Retail update is ready.</span>
          <button
            type="button"
            onClick={applyUpdate}
            className="rounded bg-white px-2 py-1 font-bold text-slate-900"
          >
            Refresh
          </button>
        </div>
      ) : null}
      {!installed && !dismissed && deferred ? (
        <div className="fixed bottom-3 right-3 z-[85] max-w-xs rounded-xl border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <p className="text-sm font-bold text-slate-900 dark:text-white">Install Finza Retail</p>
          <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400">
            Opens in its own window. Does not grant permanent serial permission or enable offline sales.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void install()}
              className="min-h-[36px] flex-1 rounded-lg bg-slate-900 px-2 text-xs font-bold text-white"
            >
              Install
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="min-h-[36px] rounded-lg px-2 text-xs font-semibold text-slate-500"
            >
              Not now
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}
