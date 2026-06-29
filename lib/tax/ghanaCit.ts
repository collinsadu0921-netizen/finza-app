export const GHANA_CIT_STANDARD_RATE_CODE = "standard_25" as const

export const GHANA_CIT_RATES = {
  standard_25: {
    rate: 0.25,
    label: "25% - Standard Company",
    basis: "profit",
  },
  hotel_22: {
    rate: 0.22,
    label: "22% - Hotel Industry",
    basis: "profit",
  },
  bank_20: {
    rate: 0.2,
    label: "20% - Bank / Financial",
    basis: "profit",
  },
  export_8: {
    rate: 0.08,
    label: "8% - Non-Traditional Exports",
    basis: "profit",
  },
  agro_1: {
    rate: 0.01,
    label: "1% - Agro-processing",
    basis: "profit",
  },
  mining_35: {
    rate: 0.35,
    label: "35% - Mining / Petroleum",
    basis: "profit",
  },
  presumptive_3: {
    rate: 0.03,
    label: "3% - Presumptive / Sole Trader",
    basis: "turnover",
  },
  exempt: {
    rate: 0,
    label: "0% - Exempt",
    basis: "profit",
  },
} as const satisfies Record<string, { rate: number; label: string; basis: "profit" | "turnover" }>

export type GhanaCitRateCode = keyof typeof GHANA_CIT_RATES
export type GhanaCitRateConfig = (typeof GHANA_CIT_RATES)[GhanaCitRateCode] & { code: GhanaCitRateCode }
export type GhanaCitProvisionType = "quarterly" | "annual" | "final"
export const GHANA_CIT_PROVISION_TYPES = ["quarterly", "annual", "final"] as const

export const GHANA_CIT_RATE_OPTIONS = Object.entries(GHANA_CIT_RATES).map(([code, config]) => ({
  code: code as GhanaCitRateCode,
  ...config,
}))

export function isGhanaCitRateCode(value: unknown): value is GhanaCitRateCode {
  return typeof value === "string" && value in GHANA_CIT_RATES
}

export function isGhanaCitProvisionType(value: unknown): value is GhanaCitProvisionType {
  return typeof value === "string" && GHANA_CIT_PROVISION_TYPES.includes(value as GhanaCitProvisionType)
}

export function resolveGhanaCitRateCode(
  value: unknown,
  options: { strict?: boolean; fallback?: GhanaCitRateCode } = {}
): GhanaCitRateCode {
  if (isGhanaCitRateCode(value)) return value
  if (options.strict) {
    throw new Error(`Unsupported Ghana CIT rate code: ${String(value || "")}`)
  }
  return options.fallback ?? GHANA_CIT_STANDARD_RATE_CODE
}

export function resolveGhanaCitRate(
  value: unknown,
  options: { strict?: boolean; fallback?: GhanaCitRateCode } = {}
): GhanaCitRateConfig {
  const code = resolveGhanaCitRateCode(value, options)
  return { code, ...GHANA_CIT_RATES[code] }
}

export function roundGhanaCitMoney(value: number): number {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}

export function calculateGhanaCitAmount(input: {
  chargeableIncome: number
  grossRevenue?: number | null
  rate: GhanaCitRateConfig | GhanaCitRateCode | number
}): {
  standardCit: number
  minimumTaxAmount: number
  minimumTaxApplies: boolean
  citAmount: number
} {
  const rateConfig =
    typeof input.rate === "string" ? resolveGhanaCitRate(input.rate) : typeof input.rate === "number" ? null : input.rate
  const rate = rateConfig ? rateConfig.rate : (input.rate as number)
  const exemptOrPresumptive = rateConfig
    ? rateConfig.code === "exempt" || rateConfig.code === "presumptive_3"
    : rate === 0 || rate === 0.03
  const standardCit = roundGhanaCitMoney(Math.max(0, input.chargeableIncome) * rate)
  const grossRevenue = Number(input.grossRevenue ?? 0)
  const minimumTaxAmount =
    !exemptOrPresumptive && grossRevenue > 0 ? roundGhanaCitMoney(grossRevenue * 0.005) : 0
  const minimumTaxApplies = minimumTaxAmount > standardCit
  return {
    standardCit,
    minimumTaxAmount,
    minimumTaxApplies,
    citAmount: Math.max(standardCit, minimumTaxAmount),
  }
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

export function getGhanaCitQuarterPeriod(year: number, quarter: number): {
  fiscalYear: number
  quarter: number
  periodStart: string
  periodEnd: string
  dueDate: string
  periodLabel: string
} {
  const safeQuarter = quarter >= 1 && quarter <= 4 ? quarter : 1
  const startMonth = (safeQuarter - 1) * 3 + 1
  const endMonth = startMonth + 2
  const periodStart = isoDate(year, startMonth, 1)
  const periodEnd = isoDate(year, endMonth, lastDayOfMonth(year, endMonth))
  return {
    fiscalYear: year,
    quarter: safeQuarter,
    periodStart,
    periodEnd,
    dueDate: periodEnd,
    periodLabel: `Q${safeQuarter} ${year}`,
  }
}

export function getGhanaCitAnnualPeriod(
  year: number,
  provisionType: Extract<GhanaCitProvisionType, "annual" | "final"> = "annual"
): {
  fiscalYear: number
  quarter: null
  periodStart: string
  periodEnd: string
  dueDate: string
  periodLabel: string
} {
  const periodStart = isoDate(year, 1, 1)
  const periodEnd = isoDate(year, 12, 31)
  return {
    fiscalYear: year,
    quarter: null,
    periodStart,
    periodEnd,
    dueDate: provisionType === "final" ? isoDate(year + 1, 4, 30) : periodEnd,
    periodLabel: `FY ${year}`,
  }
}

export function parseGhanaCitPeriodLabel(
  label: string,
  fallbackYear = new Date().getFullYear(),
  fallbackQuarter = Math.ceil((new Date().getMonth() + 1) / 3)
): { year: number; quarter: number } {
  const trimmed = label.trim()
  const q = trimmed.match(/^Q([1-4])\s+(\d{4})$/i)
  if (q) return { quarter: Number(q[1]), year: Number(q[2]) }
  const fy = trimmed.match(/^FY\s+(\d{4})$/i)
  if (fy) return { quarter: fallbackQuarter, year: Number(fy[1]) }
  const y = trimmed.match(/^(\d{4})$/)
  if (y) return { quarter: fallbackQuarter, year: Number(y[1]) }
  return { quarter: fallbackQuarter, year: fallbackYear }
}

export function buildGhanaCitPeriod(input: {
  provisionType: GhanaCitProvisionType
  periodLabel: string
  fallbackYear?: number
  fallbackQuarter?: number
}): {
  fiscalYear: number
  quarter: number | null
  periodStart: string
  periodEnd: string
  dueDate: string
  periodLabel: string
} {
  const parsed = parseGhanaCitPeriodLabel(input.periodLabel, input.fallbackYear, input.fallbackQuarter)
  if (input.provisionType === "quarterly") {
    return getGhanaCitQuarterPeriod(parsed.year, parsed.quarter)
  }
  return getGhanaCitAnnualPeriod(parsed.year, input.provisionType)
}

export function labelGhanaCitProvisionType(type: GhanaCitProvisionType): string {
  if (type === "quarterly") return "Quarterly Provisional"
  if (type === "annual") return "Annual Estimate"
  return "Final Assessment"
}
