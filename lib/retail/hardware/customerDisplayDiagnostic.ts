/**
 * Customer Display Diagnostic helpers (Retail POS pole LED).
 * Default probes are plain ASCII digits/spaces only.
 * Optional unverified candidate probes (`0C` clear; clear-then-amount) exist for look-alike
 * LED8 research on specific tills — they are not a protocol fix and must not drive sale writes.
 */

import { SEGMENTED_AMOUNT_MAX_CHARS } from "@/lib/retail/hardware/customerDisplayProtocol"

export type CustomerDisplaySerialProfile = {
  id: "2400" | "4800" | "9600" | "19200"
  label: string
  baudRate: 2400 | 4800 | 9600 | 19200
  dataBits: 8
  stopBits: 1
  parity: "none"
  flowControl: "none"
}

/** Selectable serial profiles for physical baud discovery. Default diagnostic start: 2400. */
export const CUSTOMER_DISPLAY_SERIAL_PROFILES: readonly CustomerDisplaySerialProfile[] = [
  {
    id: "2400",
    label: "2400 baud · 8N1 · no flow control",
    baudRate: 2400,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    flowControl: "none",
  },
  {
    id: "4800",
    label: "4800 baud · 8N1 · no flow control",
    baudRate: 4800,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    flowControl: "none",
  },
  {
    id: "9600",
    label: "9600 baud · 8N1 · no flow control",
    baudRate: 9600,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    flowControl: "none",
  },
  {
    id: "19200",
    label: "19200 baud · 8N1 · no flow control",
    baudRate: 19200,
    dataBits: 8,
    stopBits: 1,
    parity: "none",
    flowControl: "none",
  },
] as const

export const CUSTOMER_DISPLAY_DIAGNOSTIC_DEFAULT_PROFILE_ID: CustomerDisplaySerialProfile["id"] =
  "2400"

export type CustomerDisplayDiagnosticTestId =
  | "ascii_0_00"
  | "ascii_1234_56"
  | "spaces8_then_0_00"
  | "ascii_eight_zeroes"
  | "candidate_clear_0c"
  /** Logged for the amount half of clear-then-amount only — not a standalone button payload. */
  | "candidate_amount_ascii"

export const CANDIDATE_CLEAR_BYTE = 0x0c as const

export const CANDIDATE_CLEAR_THEN_AMOUNT_WARNING =
  "Unverified candidate for this till. Sends 0C once, then the amount ASCII once. Not a protocol fix; may fail or misalign on other displays."

/**
 * Accept digits and at most one `.`, max 8 characters (segment width).
 * Does not pad, round, or invent decimals — tester supplies the exact ASCII to send.
 */
export function parseDiagnosticAmountAscii(
  input: string
): { ok: true; ascii: string } | { ok: false; error: string } {
  const ascii = input.trim()
  if (!ascii) {
    return { ok: false, error: "Enter a numeric amount (digits and optional decimal point)." }
  }
  if (ascii.length > SEGMENTED_AMOUNT_MAX_CHARS) {
    return { ok: false, error: `Amount must be at most ${SEGMENTED_AMOUNT_MAX_CHARS} characters.` }
  }
  if (!/^[0-9.]+$/.test(ascii)) {
    return { ok: false, error: "Only digits and a single decimal point are allowed." }
  }
  if ((ascii.match(/\./g) ?? []).length > 1) {
    return { ok: false, error: "Only one decimal point is allowed." }
  }
  if (!/[0-9]/.test(ascii)) {
    return { ok: false, error: "Amount must include at least one digit." }
  }
  return { ok: true, ascii }
}

export function buildCandidateClearThenAmountPreview(amountInput: string): {
  valid: boolean
  error: string | null
  ascii: string | null
  clearHex: string
  amountHex: string | null
  clearBytes: Uint8Array
  amountBytes: Uint8Array | null
} {
  const clearBytes = new Uint8Array([CANDIDATE_CLEAR_BYTE])
  const clearHex = bytesToHexPreview(clearBytes)
  const parsed = parseDiagnosticAmountAscii(amountInput)
  if (!parsed.ok) {
    return {
      valid: false,
      error: parsed.error,
      ascii: null,
      clearHex,
      amountHex: null,
      clearBytes,
      amountBytes: null,
    }
  }
  const amountBytes = asciiToDiagnosticBytes(parsed.ascii)
  return {
    valid: true,
    error: null,
    ascii: parsed.ascii,
    clearHex,
    amountHex: bytesToHexPreview(amountBytes),
    clearBytes,
    amountBytes,
  }
}

export type CustomerDisplayDiagnosticTest = {
  id: CustomerDisplayDiagnosticTestId
  name: string
  /**
   * Human-readable payload description for the UI.
   * For ASCII probes this is the exact string encoded; for raw probes it is descriptive only.
   */
  ascii: string
  /** When set, these exact bytes are written instead of encoding `ascii`. */
  rawBytes?: readonly number[]
  /** UI warning shown near the button (candidate / unverified probes). */
  warning?: string
}

export const CUSTOMER_DISPLAY_DIAGNOSTIC_TESTS: readonly CustomerDisplayDiagnosticTest[] = [
  { id: "ascii_0_00", name: "ASCII 0.00", ascii: "0.00" },
  { id: "ascii_1234_56", name: "ASCII 1234.56", ascii: "1234.56" },
  {
    id: "spaces8_then_0_00",
    name: "Eight spaces then 0.00",
    ascii: "        0.00",
  },
  { id: "ascii_eight_zeroes", name: "Eight ASCII zeroes", ascii: "00000000" },
  {
    id: "candidate_clear_0c",
    name: "Test candidate clear (0C)",
    ascii: "(single byte 0C)",
    rawBytes: [0x0c],
    warning:
      "Unverified for this display. Sends one byte once; the panel may not clear and may show an unexpected character.",
  },
] as const

/** ASCII-only probes (excludes the unverified candidate-clear byte). */
export const CUSTOMER_DISPLAY_DIAGNOSTIC_ASCII_TESTS = CUSTOMER_DISPLAY_DIAGNOSTIC_TESTS.filter(
  (t) => t.id !== "candidate_clear_0c"
)

export const CUSTOMER_DISPLAY_DIAGNOSTIC_POWER_CYCLE_HINT =
  "Power-cycle the terminal customer display between baud-rate profiles if the panel looks wrong or stays blank."

export const CUSTOMER_DISPLAY_DIAGNOSTIC_LOG_KEY =
  "finza.retail.customerDisplay.diagnosticLog"

export const CUSTOMER_DISPLAY_DIAGNOSTIC_LOG_MAX = 40

export type CustomerDisplayDiagnosticLogEntry = {
  baudRate: number
  testName: string
  testId: CustomerDisplayDiagnosticTestId
  bytesHex: string
  timestamp: string
  ok: boolean
  error: string | null
}

export function getCustomerDisplaySerialProfile(
  id: CustomerDisplaySerialProfile["id"]
): CustomerDisplaySerialProfile {
  const found = CUSTOMER_DISPLAY_SERIAL_PROFILES.find((p) => p.id === id)
  if (!found) {
    return CUSTOMER_DISPLAY_SERIAL_PROFILES[0]
  }
  return found
}

export function asciiToDiagnosticBytes(ascii: string): Uint8Array {
  const bytes = new Uint8Array(ascii.length)
  for (let i = 0; i < ascii.length; i++) {
    bytes[i] = ascii.charCodeAt(i) & 0x7f
  }
  return bytes
}

export function buildCustomerDisplayDiagnosticBytes(
  testId: CustomerDisplayDiagnosticTestId
): Uint8Array {
  const test = CUSTOMER_DISPLAY_DIAGNOSTIC_TESTS.find((t) => t.id === testId)
  if (!test) {
    return asciiToDiagnosticBytes("0.00")
  }
  if (test.rawBytes && test.rawBytes.length > 0) {
    return new Uint8Array(test.rawBytes)
  }
  return asciiToDiagnosticBytes(test.ascii)
}

export function bytesToHexPreview(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).toUpperCase().padStart(2, "0"))
    .join(" ")
}

export function getCustomerDisplayDiagnosticTest(
  testId: CustomerDisplayDiagnosticTestId
): CustomerDisplayDiagnosticTest {
  return (
    CUSTOMER_DISPLAY_DIAGNOSTIC_TESTS.find((t) => t.id === testId) ??
    CUSTOMER_DISPLAY_DIAGNOSTIC_TESTS[0]
  )
}

/** Pure helper: diagnostic mode must suppress automatic basket/total writes. */
export function shouldSuppressAutoCustomerDisplayWrites(diagnosticMode: boolean): boolean {
  return diagnosticMode === true
}

export function appendCustomerDisplayDiagnosticLog(
  existing: CustomerDisplayDiagnosticLogEntry[],
  entry: CustomerDisplayDiagnosticLogEntry,
  max = CUSTOMER_DISPLAY_DIAGNOSTIC_LOG_MAX
): CustomerDisplayDiagnosticLogEntry[] {
  return [entry, ...existing].slice(0, Math.max(1, max))
}

export function readCustomerDisplayDiagnosticLogFromStorage(
  storage: Pick<Storage, "getItem"> | null | undefined
): CustomerDisplayDiagnosticLogEntry[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(CUSTOMER_DISPLAY_DIAGNOSTIC_LOG_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isDiagnosticLogEntry)
  } catch {
    return []
  }
}

export function writeCustomerDisplayDiagnosticLogToStorage(
  storage: Pick<Storage, "setItem"> | null | undefined,
  entries: CustomerDisplayDiagnosticLogEntry[]
): void {
  if (!storage) return
  try {
    storage.setItem(CUSTOMER_DISPLAY_DIAGNOSTIC_LOG_KEY, JSON.stringify(entries.slice(0, CUSTOMER_DISPLAY_DIAGNOSTIC_LOG_MAX)))
  } catch {
    /* quota / private mode — never block sales */
  }
}

function isDiagnosticLogEntry(value: unknown): value is CustomerDisplayDiagnosticLogEntry {
  if (!value || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  return (
    typeof v.baudRate === "number" &&
    typeof v.testName === "string" &&
    typeof v.testId === "string" &&
    typeof v.bytesHex === "string" &&
    typeof v.timestamp === "string" &&
    typeof v.ok === "boolean" &&
    (v.error === null || typeof v.error === "string")
  )
}
