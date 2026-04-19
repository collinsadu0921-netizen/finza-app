/**
 * Opens a prefilled WhatsApp (wa.me) URL. When a tab was opened synchronously on the same
 * user gesture (e.g. `about:blank`), assign `location.href` after an async `/send` response
 * so the browser does not treat it as a blocked popup.
 */
export function openWhatsAppUrlInBrowser(url: string, prepWindow: Window | null): boolean {
  if (!/^https:\/\/wa\.me\//i.test(String(url))) return false

  const closePrep = () => {
    if (prepWindow && !prepWindow.closed) {
      try {
        prepWindow.close()
      } catch {
        /* ignore */
      }
    }
  }

  let opened = false
  let navigatedPrep = false
  if (prepWindow && !prepWindow.closed) {
    try {
      prepWindow.location.href = url
      opened = true
      navigatedPrep = true
    } catch {
      opened = false
    }
  }
  if (!opened) {
    const w = window.open(url, "_blank")
    opened = !!w
  }
  if (prepWindow && !prepWindow.closed && !navigatedPrep) {
    try {
      prepWindow.close()
    } catch {
      /* ignore */
    }
  }
  if (!opened) closePrep()
  return opened
}
