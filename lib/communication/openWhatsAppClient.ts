/**
 * Mobile browsers often open https://wa.me/... in a new tab as a generic web page ("Get WhatsApp")
 * instead of handing off to the WhatsApp app. This module:
 * - Rewrites wa.me → https://api.whatsapp.com/send?phone=&text= on phones (better app handoff).
 * - Optionally navigates the current tab on mobile (reliable) after a sync callback (e.g. close modal).
 */

export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false
  const ua = navigator.userAgent || ""
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|CriOS|FxiOS/i.test(ua)) {
    return true
  }
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } }
  if (nav.userAgentData?.mobile) return true
  return false
}

/**
 * Rewrite https://wa.me/{digits}?text=... to api.whatsapp.com/send (recommended for mobile handoff).
 */
export function convertWaMeToApiSendUrl(waMeUrl: string): string {
  try {
    const u = new URL(String(waMeUrl).trim())
    if (!/^wa\.me$/i.test(u.hostname)) return waMeUrl
    const phone = u.pathname.replace(/^\//, "").replace(/\D/g, "")
    if (phone.length < 8) return waMeUrl
    const out = new URL("https://api.whatsapp.com/send")
    out.searchParams.set("phone", phone)
    const text = u.searchParams.get("text")
    if (text != null && text !== "") {
      out.searchParams.set("text", text)
    }
    return out.toString()
  } catch {
    return waMeUrl
  }
}

function navigateUrlForDevice(url: string): string {
  if (!isMobileDevice()) return url
  return convertWaMeToApiSendUrl(url)
}

function closePrepWindow(prepWindow: Window | null): void {
  if (prepWindow && !prepWindow.closed) {
    try {
      prepWindow.close()
    } catch {
      /* ignore */
    }
  }
}

export type OpenWhatsAppOptions = {
  /**
   * When true on a phone, navigates this tab to WhatsApp after `onBeforeSameTabNavigate`
   * (avoids wa.me opening as a "download WhatsApp" promo in a new tab). Do not use for flows
   * that must run more client navigation in the same tab immediately after (e.g. post-create redirect).
   */
  preferSameTabOnMobile?: boolean
  /** Called synchronously immediately before same-tab `location.assign` (close modals, run onSuccess, etc.). */
  onBeforeSameTabNavigate?: () => void
}

/** `true` = opened in prep tab or new tab; `'same-tab'` = current tab navigated (callback already run); `false` = failed */
export type OpenWhatsAppResult = boolean | "same-tab"

/**
 * Opens a prefilled WhatsApp link. When a tab was opened synchronously on the same user gesture
 * (e.g. `about:blank`), assigns `location.href` after an async `/send` response so popups are not blocked.
 */
export function openWhatsAppUrlInBrowser(
  url: string,
  prepWindow: Window | null,
  opts?: OpenWhatsAppOptions
): OpenWhatsAppResult {
  if (!/^https:\/\/wa\.me\//i.test(String(url))) return false

  const target = navigateUrlForDevice(String(url))

  if (isMobileDevice() && opts?.preferSameTabOnMobile) {
    closePrepWindow(prepWindow)
    opts.onBeforeSameTabNavigate?.()
    try {
      window.location.assign(target)
    } catch {
      return false
    }
    return "same-tab"
  }

  let opened = false
  let navigatedPrep = false
  if (prepWindow && !prepWindow.closed) {
    try {
      prepWindow.location.href = target
      opened = true
      navigatedPrep = true
    } catch {
      opened = false
    }
  }
  if (!opened) {
    const w = window.open(target, "_blank")
    opened = !!w
  }
  if (prepWindow && !prepWindow.closed && !navigatedPrep) {
    try {
      prepWindow.close()
    } catch {
      /* ignore */
    }
  }
  if (!opened) closePrepWindow(prepWindow)
  return opened
}
