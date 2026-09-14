/** Standard 20-column VFD / pole display line width. */
export const CUSTOMER_DISPLAY_COLUMNS = 20

export type CustomerDisplayView =
  | { kind: "idle"; idleMessage?: string }
  | { kind: "item"; itemName: string; runningTotal: number; currencyCode: string }
  | { kind: "due"; amountDue: number; currencyCode: string }
  | { kind: "tendered"; tendered: number; change: number; currencyCode: string }

function asciiSafe(text: string): string {
  return text.replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim()
}

export function padDisplayLine(text: string, width = CUSTOMER_DISPLAY_COLUMNS): string {
  const t = asciiSafe(text).slice(0, width)
  if (t.length >= width) return t
  return t + " ".repeat(width - t.length)
}

export function formatDisplayMoney(amount: number, currencyCode?: string): string {
  const n = Number.isFinite(amount) ? amount : 0
  const body = n.toFixed(2)
  const code = (currencyCode || "").trim()
  if (!code) return body
  const withCode = `${code} ${body}`
  return withCode.length <= CUSTOMER_DISPLAY_COLUMNS ? withCode : body
}

export function formatCustomerDisplayLines(view: CustomerDisplayView): { line1: string; line2: string } {
  switch (view.kind) {
    case "idle": {
      const msg = asciiSafe(view.idleMessage || "")
      return {
        line1: padDisplayLine(msg || "THANK YOU"),
        line2: padDisplayLine(formatDisplayMoney(0)),
      }
    }
    case "item": {
      return {
        line1: padDisplayLine(view.itemName),
        line2: padDisplayLine(`TOTAL ${formatDisplayMoney(view.runningTotal, view.currencyCode)}`),
      }
    }
    case "due": {
      return {
        line1: padDisplayLine("AMOUNT DUE"),
        line2: padDisplayLine(formatDisplayMoney(view.amountDue, view.currencyCode)),
      }
    }
    case "tendered": {
      return {
        line1: padDisplayLine(`PAID ${formatDisplayMoney(view.tendered, view.currencyCode)}`),
        line2: padDisplayLine(`CHANGE ${formatDisplayMoney(view.change, view.currencyCode)}`),
      }
    }
  }
}

function encodeAscii(text: string): number[] {
  const out: number[] = []
  for (let i = 0; i < text.length; i++) {
    out.push(text.charCodeAt(i) & 0x7f)
  }
  return out
}

/**
 * Xprinter / BillPoint compatible 2-line VFD commands (ESC Q A / ESC Q B).
 * This is a text pole display, not a graphical second screen.
 */
export function buildCustomerDisplayBytes(line1: string, line2: string): Uint8Array {
  const l1 = padDisplayLine(line1)
  const l2 = padDisplayLine(line2)
  const bytes = [
    0x1b, 0x40, // ESC @ initialize
    0x0c, // FF clear
    0x1b, 0x51, 0x41, // ESC Q A — upper line
    ...encodeAscii(l1),
    0x0d,
    0x1b, 0x51, 0x42, // ESC Q B — lower line
    ...encodeAscii(l2),
    0x0d,
  ]
  return Uint8Array.from(bytes)
}

/** ESC p pin2 / pin5 drawer-kick pulses (same command as ESCPOSGenerator). */
export function buildCashDrawerKickBytes(): Uint8Array {
  return Uint8Array.from([
    0x1b, 0x70, 0x00, 0x19, 0xfa, // pin 2
    0x1b, 0x70, 0x01, 0x19, 0xfa, // pin 5 (some T80E jumpers)
  ])
}

export function saleIncludesCashTender(input: {
  paymentMethod?: string | null
  paymentBreakdown?: Array<{ method: string; amount: number }> | null
}): boolean {
  const lines = (input.paymentBreakdown || []).filter((row) => Number(row.amount) > 0)
  if (lines.some((row) => row.method.trim().toLowerCase().includes("cash"))) {
    return true
  }
  if (lines.length > 0) return false
  const pm = (input.paymentMethod || "").trim().toLowerCase()
  return pm === "cash" || pm.includes("cash")
}
