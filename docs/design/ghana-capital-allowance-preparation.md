# Ghana Capital Allowance — Future Design Note

## Status

**Prepared only.** No tax capital allowance calculations are implemented in P0 (migration 566).

## Principle

Finza book accounting and Ghana Revenue Authority (GRA) tax treatment must remain **separate ledgers**. Financial statements use IFRS / IFRS for SMEs compatible classification and normal accounting depreciation. Tax reporting uses GRA capital allowance rules in a dedicated tax layer.

## Book accounting (existing / unchanged in P0)

| Concept | Storage / behavior |
|---------|-------------------|
| Acquisition cost | Asset register + GL fixed asset control |
| Useful life | Asset metadata |
| Residual / salvage | Asset metadata |
| Accounting depreciation | Depreciation engine → expense + accumulated depreciation |
| Carrying value | Cost − accumulated depreciation |
| Disposal gain/loss | Disposal posting to income/expense control accounts |

P0 preserves acquisition, depreciation, backfill, disposal, period locks, reversals, and audit semantics.

## Ghana tax layer (future)

Extensible metadata on assets (nullable columns or side table — TBD):

| Field | Purpose |
|-------|---------|
| `gra_capital_allowance_class` | e.g. computers, vehicles, furniture, buildings, intangibles |
| `tax_pool` | GRA pool identifier |
| `tax_depreciation_basis` | Cost basis for allowance |
| `capital_allowance_rate` | Statutory rate (not hard-coded in core engine) |
| `allowance_method` | reducing_balance / straight_line as applicable |
| `capital_allowance_claimed` | Cumulative tax allowance |
| `tax_written_down_value` | Tax WDV after allowances |

Example GRA classes (from current guidance — verify at implementation time):

- Computers and data handling equipment
- Vehicles and manufacturing plant / machinery
- Office furniture and equipment
- Buildings and structures
- Intangible assets

## Control account architecture (direction)

Move posting toward semantic **control roles** mapped to tenant COA:

- `FIXED_ASSET`, `ACCUMULATED_DEPRECIATION`, `DEPRECIATION_EXPENSE`
- `ASSET_DISPOSAL_GAIN`, `ASSET_DISPOSAL_LOSS`
- `LOAN_SHORT_TERM`, `LOAN_LONG_TERM`
- `BANK`, `CASH`, `MOBILE_MONEY`

P0 adds semantic `sub_type` on COA and loan subledger; full control-map indirection is a follow-on.

## Hard-coded codes audit (Assets — P0 scope)

| Code | Role today | P0 action |
|------|------------|-----------|
| 1000, 1010, 1020 | Default funding | **Removed from asset payment picker** — use `sub_type` |
| 1600 | Fixed asset control | Remains system default; future control role |
| 1650 | Accumulated depreciation | Remains system default; future control role |
| 5700 | Depreciation expense | Remains system default; future control role |
| 4200 / 5800 | Disposal gain/loss | Remains system default; future control role |
| 1100 | AR (some asset flows) | Unchanged in P0 |

## Non-goals (P0)

- No GRA rate tables in core asset module
- No replacement of book depreciation with tax allowance
- No automatic merge of book and tax WDV
- No manufacturing-specific tax pools

## Recommended next steps

1. Add `asset_tax_profile` side table keyed by `assets.id`
2. Version GRA rates in configuration (effective-dated)
3. Capital allowance report (tax workspace) reading tax profile + asset register
4. Control-account map table for posting engine fallback
