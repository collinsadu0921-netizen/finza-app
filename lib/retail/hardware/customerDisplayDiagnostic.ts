/**
 * Customer Display Diagnostic helpers (Retail POS pole LED).
 * Default probes are plain ASCII digits/spaces only.
 * One optional candidate-clear probe (`0C`) exists for look-alike LED8 research —
 * it is unverified for any specific till and is not a protocol fix.
 */

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
