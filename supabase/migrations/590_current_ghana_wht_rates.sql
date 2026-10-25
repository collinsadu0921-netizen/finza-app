-- ============================================================================
-- Migration 590: Current Ghana income-tax WHT categories and rates
--
-- Source: GRA withholding-tax table / Income Tax Act 2015 (Act 896), as
-- amended. This migration only seeds/updates the wht_rates reference table.
-- It does not change historical bills, invoices, payments or journals.
--
-- Resident contract separation:
--   services 7.5%, works 5%, goods 3%.
-- Rent:
--   residential 8%, non-residential 15%.
-- Non-resident 20% is split into management/technical fees and
-- goods/works/services contracts; it is not a universal non-resident rate.
-- ============================================================================

INSERT INTO public.wht_rates (
  code,
  name,
  rate,
  description,
  jurisdiction,
  effective_from,
  active
)
VALUES
  (
    'GH_SVC_75',
    'Resident services - 7.5%',
    0.0750,
    'Resident contract services. Non-final; applies only where the contract value exceeds GHS 2,000. Base excludes VAT, NHIL and GETFund; related contracts are aggregated.',
    'GH',
    DATE '2026-01-01',
    TRUE
  ),
  (
    'GH_WORKS_5',
    'Resident works - 5%',
    0.0500,
    'Resident contract works. Non-final; applies only where the contract value exceeds GHS 2,000. Base excludes VAT, NHIL and GETFund.',
    'GH',
    DATE '2026-01-01',
    TRUE
  ),
  (
    'GH_GOODS_3',
    'Resident goods - 3%',
    0.0300,
    'Resident contract goods. Non-final; applies only where the contract value exceeds GHS 2,000. Excludes trading stock of both parties and written exemptions. Base excludes VAT, NHIL and GETFund.',
    'GH',
    DATE '2026-01-01',
    TRUE
  ),
  (
    'GH_RENT_RES_8',
    'Residential rent - 8%',
    0.0800,
    'Investment rent for residential property. Final withholding; not for rent received in a property sale or letting business.',
    'GH',
    DATE '2026-01-01',
    TRUE
  ),
  (
    'GH_RENT_NONRES_15',
    'Non-residential rent - 15%',
    0.1500,
    'Investment rent for non-residential property. Final withholding; not for rent received in a property sale or letting business.',
    'GH',
    DATE '2026-01-01',
    TRUE
  ),
  (
    'GH_DIV_8',
    'Resident dividends - 8%',
    0.0800,
    'Dividends paid by a resident company. Final withholding; the 25% resident inter-company exemption and petroleum/mineral exceptions apply.',
    'GH',
    DATE '2026-01-01',
    TRUE
  ),
  (
    'GH_INT_8',
    'Resident interest - 8%',
    0.0800,
    'Interest paid to residents. Non-final; excludes individuals and resident financial institutions, and exempt interest is not withheld.',
    'GH',
    DATE '2026-01-01',
    TRUE
  ),
  (
    'GH_MGMT_20',
    'Non-resident management / technical fees - 20%',
    0.2000,
    'Domestic 20% final rate for non-resident management or technical service fees, before treaty relief. A lower treaty rate requires GRA approval and the lower of domestic/treaty applies.',
    'GH',
    DATE '2026-01-01',
    TRUE
  ),
  (
    'GH_NR_CONTRACT_20',
    'Non-resident goods / works / services contract - 20%',
    0.2000,
    'Domestic 20% final rate for non-resident goods, works or services contracts. This is not a universal non-resident rate; treaty relief may lower it with GRA approval.',
    'GH',
    DATE '2026-01-01',
    TRUE
  ),
  (
    'GH_NR_DIV_8',
    'Non-resident dividends - 8%',
    0.0800,
    'Domestic 8% final rate for non-resident dividends not derived through a Ghanaian permanent establishment. Treaty relief may apply with GRA approval.',
    'GH',
    DATE '2026-01-01',
    TRUE
  ),
  (
    'GH_NR_INT_8',
    'Non-resident interest - 8%',
    0.0800,
    'Domestic 8% final rate for non-resident interest not derived through a Ghanaian permanent establishment. Exempt interest and treaty relief may apply.',
    'GH',
    DATE '2026-01-01',
    TRUE
  ),
  (
    'GH_NR_RENT_15',
    'Non-resident rent / royalty / natural resources - 15%',
    0.1500,
    'Domestic 15% final rate for non-resident rent, royalties or natural-resource payments, before treaty relief and permanent-establishment analysis.',
    'GH',
    DATE '2026-01-01',
    TRUE
  )
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  rate = EXCLUDED.rate,
  description = EXCLUDED.description,
  jurisdiction = EXCLUDED.jurisdiction,
  active = TRUE;

-- Legacy codes remain valid for historical FK references, but must not be
-- selected for new transactions.
UPDATE public.wht_rates
SET active = FALSE
WHERE code IN ('GH_SVC_5', 'GH_RENT_8', 'GH_NR_20');
