/**
 * Withholding Tax (WHT) helpers for Ghana
 *
 * WHT is deducted at source from payments to suppliers/residents.
 * The payer withholds the tax and remits it to GRA on behalf of the recipient.
 *
 * Income-tax WHT is calculated on the taxable value BEFORE VAT, NHIL and
 * GETFund. It is separate from the 7% VAT-withholding mechanism.
 */

export type WHTRate = {
  code: string
  name: string
  rate: number // decimal, e.g. 0.075 for 7.5%
  description: string
  category:
    | "resident_contract"
    | "resident_rent"
    | "resident_dividend"
    | "resident_interest"
    | "non_resident"
}

/** Resident contract WHT applies only where the contract value exceeds GHS 2,000. */
export const WHT_CONTRACT_THRESHOLD_GHS = 2000

/**
 * Resident goods/works/services contract categories. The GHS 2,000 threshold
 * belongs to these categories only; it is not a universal WHT threshold.
 */
export const RESIDENT_CONTRACT_WHT_CODES = new Set([
  "GH_SVC_75",
  "GH_WORKS_5",
  "GH_GOODS_3",
  // Legacy code retained for historical records; new entries use GH_WORKS_5.
  "GH_SVC_5",
])

/**
 * Current GRA withholding-tax categories used by the Service workspace.
 *
 * Non-resident 20% is deliberately split into management/technical fees and
 * goods/works/services contracts. It is a domestic rate, not a universal
 * non-resident rate; treaty relief can lower it but requires GRA approval.
 */
export const GH_WHT_RATES: WHTRate[] = [
  {
    code: "GH_SVC_75",
    name: "Resident services - 7.5%",
    rate: 0.075,
    description:
      "Resident contract services. Non-final; applies only where the contract value exceeds GHS 2,000. Base excludes VAT, NHIL and GETFund; related contracts are aggregated.",
    category: "resident_contract",
  },
  {
    code: "GH_WORKS_5",
    name: "Resident works - 5%",
    rate: 0.05,
    description:
      "Resident contract works. Non-final; applies only where the contract value exceeds GHS 2,000. Base excludes VAT, NHIL and GETFund.",
    category: "resident_contract",
  },
  {
    code: "GH_GOODS_3",
    name: "Resident goods - 3%",
    rate: 0.03,
    description:
      "Resident contract goods. Non-final; applies only where the contract value exceeds GHS 2,000. Excludes trading stock of both parties and written exemptions. Base excludes VAT, NHIL and GETFund.",
    category: "resident_contract",
  },
  {
    code: "GH_RENT_RES_8",
    name: "Residential rent - 8%",
    rate: 0.08,
    description:
      "Investment rent for residential property. Final withholding; not for rent received in a property sale or letting business.",
    category: "resident_rent",
  },
  {
    code: "GH_RENT_NONRES_15",
    name: "Non-residential rent - 15%",
    rate: 0.15,
    description:
      "Investment rent for non-residential property. Final withholding; not for rent received in a property sale or letting business.",
    category: "resident_rent",
  },
  {
    code: "GH_DIV_8",
    name: "Resident dividends - 8%",
    rate: 0.08,
    description:
      "Dividends paid by a resident company. Final withholding; the 25% resident inter-company exemption and petroleum/mineral exceptions apply.",
    category: "resident_dividend",
  },
  {
    code: "GH_INT_8",
    name: "Resident interest - 8%",
    rate: 0.08,
    description:
      "Interest paid to residents. Non-final; excludes individuals and resident financial institutions, and exempt interest is not withheld.",
    category: "resident_interest",
  },
  {
    code: "GH_MGMT_20",
    name: "Non-resident management / technical fees - 20%",
    rate: 0.2,
    description:
      "Domestic 20% final rate for non-resident management or technical service fees, before treaty relief. A lower treaty rate requires GRA approval and the lower of domestic/treaty applies.",
    category: "non_resident",
  },
  {
    code: "GH_NR_CONTRACT_20",
    name: "Non-resident goods / works / services contract - 20%",
    rate: 0.2,
    description:
      "Domestic 20% final rate for non-resident goods, works or services contracts. This is not a universal non-resident rate; treaty relief may lower it with GRA approval.",
    category: "non_resident",
  },
  {
    code: "GH_NR_DIV_8",
    name: "Non-resident dividends - 8%",
    rate: 0.08,
    description:
      "Domestic 8% final rate for non-resident dividends not derived through a Ghanaian permanent establishment. Treaty relief may apply with GRA approval.",
    category: "non_resident",
  },
  {
    code: "GH_NR_INT_8",
    name: "Non-resident interest - 8%",
    rate: 0.08,
    description:
      "Domestic 8% final rate for non-resident interest not derived through a Ghanaian permanent establishment. Exempt interest and treaty relief may apply.",
    category: "non_resident",
  },
  {
    code: "GH_NR_RENT_15",
    name: "Non-resident rent / royalty / natural resources - 15%",
    rate: 0.15,
    description:
      "Domestic 15% final rate for non-resident rent, royalties or natural-resource payments, before treaty relief and permanent-establishment analysis.",
    category: "non_resident",
  },
]

/** Legacy codes retained in the database for historical bill references. */
export const LEGACY_WHT_RATE_CODES = new Set([
  "GH_SVC_5",
  "GH_RENT_8",
  "GH_NR_20",
])

export function isResidentContractWhtCode(
  code: string | null | undefined
): boolean {
  return !!code && RESIDENT_CONTRACT_WHT_CODES.has(code)
}

/**
 * The resident contract threshold is tested on the GHS contract value before
 * VAT and levies. A contract exactly at GHS 2,000 does not qualify.
 */
export function whtContractThresholdMet(
  code: string | null | undefined,
  baseAmountGhs: number
): boolean {
  if (!isResidentContractWhtCode(code)) return true
  return Number(baseAmountGhs) > WHT_CONTRACT_THRESHOLD_GHS
}

/**
 * Calculate WHT from a pre-tax base.
 *
 * For tax-inclusive entry, pass the back-calculated pre-tax base (subtotal
 * excluding VAT/NHIL/GETFund), not the tax-inclusive document total.
 */
export function calculateWHT(
  baseAmount: number,
  rate: number
): {
  whtAmount: number
  netPayable: number
} {
  const whtAmount = Math.round(Number(baseAmount) * Number(rate) * 100) / 100
  const netPayable =
    Math.round((Number(baseAmount) - whtAmount) * 100) / 100
  return { whtAmount, netPayable }
}

/**
 * Calculate WHT with the resident-contract threshold applied.
 * `baseAmountGhs` must be the GHS equivalent of the pre-tax base.
 */
export function calculateWHTForRate(input: {
  baseAmount: number
  rate: number
  code?: string | null
  baseAmountGhs?: number
}): {
  whtAmount: number
  netPayable: number
  thresholdMet: boolean
  thresholdGhs?: number
} {
  const baseGhs =
    input.baseAmountGhs != null ? input.baseAmountGhs : input.baseAmount
  const thresholdMet = whtContractThresholdMet(input.code, baseGhs)
  if (!thresholdMet) {
    return {
      whtAmount: 0,
      netPayable: Math.round(Number(input.baseAmount) * 100) / 100,
      thresholdMet: false,
      thresholdGhs: WHT_CONTRACT_THRESHOLD_GHS,
    }
  }

  const { whtAmount, netPayable } = calculateWHT(
    input.baseAmount,
    input.rate
  )
  return {
    whtAmount,
    netPayable,
    thresholdMet: true,
    ...(isResidentContractWhtCode(input.code)
      ? { thresholdGhs: WHT_CONTRACT_THRESHOLD_GHS }
      : {}),
  }
}

/** Get a current WHT rate by code. Legacy codes are not returned. */
export function getWHTRate(code: string): WHTRate | undefined {
  return GH_WHT_RATES.find((r) => r.code === code)
}

/** Format 0.075 as 7.5%, 0.05 as 5%, 0.15 as 15%. */
export function formatWHTRate(rate: number): string {
  const pct = Math.round(Number(rate) * 1000) / 10
  return `${Number.isFinite(pct) ? pct : 0}%`
}
