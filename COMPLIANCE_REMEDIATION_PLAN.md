# Compliance Remediation Plan: Ordered Execution Sequence

**Date:** 2025-01-28  
**Architect:** Principal Accounting Systems Design  
**Scope:** Phase-by-phase remediation of Minimum Correct Accounting Model violations  
**Purpose:** Define ordered execution sequence that establishes correct accounting invariants

---

## Phase 1: Automatic Sales Posting

**Invariant Established:** Every operational sale creates a corresponding journal entry atomically.

**Failures Eliminated:**
- Sales exist without journal entries (Completeness failure)
- Accounting event non-atomicity (Structural design failure)
- Missing journal entry header (Rule 6.1 violation)

**Remediation:**
- Ensure every sale creation triggers `post_sale_to_ledger` function call
- Establish automatic posting mechanism (trigger or application-level call)
- Guarantee journal entry creation with `reference_type='sale'` and `reference_id=sale.id`

**Dependency:** None - Foundation layer

---

## Phase 2: Complete Ledger Movements

**Invariant Established:** Every sales journal entry contains all five mandatory ledger movements.

**Failures Eliminated:**
- Missing COGS expense DEBIT (Rule 2.4 violation)
- Missing inventory asset CREDIT (Rule 2.5 violation)
- Incomplete journal entry lines (Rule 6.2 violation)

**Remediation:**
- Add COGS expense DEBIT posting to `post_sale_to_ledger` function
- Add inventory asset CREDIT posting to `post_sale_to_ledger` function
- Ensure posting logic creates exactly five journal entry lines per sale

**Dependency:** Phase 1 - Requires automatic posting to exist first

---

## Phase 3: Operational-to-Ledger Reconciliation

**Invariant Established:** All accounting amounts reconcile between operational tables and ledger.

**Failures Eliminated:**
- COGS values exist only in operational tables, not ledger (Rule 6.4 violation)
- Inventory reductions exist only in operational tables, not ledger (Rule 6.4 violation)
- Reconciliation impossible for missing movements (Accuracy failure)

**Remediation:**
- Establish COGS amount reconciliation: `sale_items.cogs` total matches COGS DEBIT in ledger
- Establish inventory amount reconciliation: `products_stock` reduction matches inventory CREDIT in ledger
- Verify all sales have complete reconciliation between operational and accounting records

**Dependency:** Phase 2 - Requires complete ledger movements to exist first

---

## Phase 4: Financial Statement Accuracy

**Invariant Established:** Financial statements generate correctly from ledger-only source.

**Failures Eliminated:**
- P&L shows incorrect or zero COGS (Rule 7.2 violation)
- Balance Sheet shows incorrect or overstated inventory assets (Rule 7.3 violation)
- Financial statements must reference operational tables (Architectural violation)

**Remediation:**
- Verify P&L COGS calculation uses ledger-only source (journal_entry_lines with COGS account)
- Verify Balance Sheet inventory calculation uses ledger-only source (journal_entry_lines with inventory account)
- Remove any financial statement logic that references operational tables directly

**Dependency:** Phase 3 - Requires reconciliation to be established first

---

## Execution Order Summary

**Phase 1 → Phase 2 → Phase 3 → Phase 4**

Each phase depends on the previous phase being complete. No phase can execute before its dependencies are established. The sequence guarantees that foundational invariants are established before dependent features are implemented.

---

**Plan Complete - Execution Sequence Defined - No Implementation Details Provided**
