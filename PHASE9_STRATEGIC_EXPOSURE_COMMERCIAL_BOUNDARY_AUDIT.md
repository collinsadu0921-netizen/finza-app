# PHASE 9 — Strategic Exposure & Commercial Boundary Audit (Deterministic)

**Audit type:** Principal product, platform economics, and systems boundary auditor  
**Mode:** Deterministic evaluation against the locked Finza vision.  
**No code. No refactors. No "nice-to-haves."**  
**Date:** 2025-01-31  
**Inputs (LOCKED):**  
- Phase 2 — Canonical Authority & Context Model  
- Phase 4 — Canonical Authorization Unification  
- Phase 6 — UI Context Resolution Refactor  
- Phase 7 — Cross-Workspace Context Integrity Audit  
- Phase 8 — Accounting Exposure & External Portability Audit  

---

## OBJECTIVE (NON-NEGOTIABLE)

Determine **what must be exposed, what must remain gated, and why**, such that:

1. **Businesses can fully own their accounting truth**
2. **Accountants add leverage, not access**
3. **Finza preserves a strong commercial moat without artificial lock-in**
4. **Leakage (financial + behavioral) is structurally minimized**

This phase answers one question only:

> Which accounting capabilities should belong to **Business**, which to **Firm**, and which must remain **exclusive** — for the system to be economically defensible and operationally correct?

---

## PART 1 — ROLE REALITY CHECK (GROUND TRUTH)

### 1.1 Business Owners (Retail / Service)

**Reality:**
- Operate daily without accountants
- Need confidence, visibility, and portability
- Will only engage accountants episodically (tax, audit, growth)

**Non-negotiable rights:**
- Full visibility of books
- Ability to export books
- Ability to change accountants without friction

**Risk if underpowered:**
- Shadow accounting
- Parallel Excel books
- Loss of trust in Finza

---

### 1.2 In-House Accountants (Employees)

**Reality:**
- Operate inside the business
- Do not manage multiple clients
- Do not need firm tooling

**Key distinction:**
> They are **business operators**, not service providers.

**Risk if overpowered:**
- Blurred line between business and firm
- Accidental leakage of firm-only leverage

---

### 1.3 Accounting Firms

**Reality:**
- Monetize **scale, comparison, delegation, and workflow**
- Care about:
  - Multi-client views
  - Standardization
  - Review/approval layers
  - Bulk operations
  - Compliance workflows

**They do NOT own the books.**  
They **act on delegated truth**.

**Risk if underpowered:**
- No incentive to onboard clients
- No differentiation from exports

---

## PART 2 — STRATEGIC SURFACE CLASSIFICATION

Each accounting capability is classified into **exactly one** surface.

### Surface Definitions

| Surface | Definition |
|---------|------------|
| **Business Core** | Must always be accessible to the business (owner/admin/accountant employee) |
| **Firm Leverage** | Exists to make firms faster, scalable, and sticky |
| **Exclusive Control** | Must remain gated to preserve integrity or trust |

---

## PART 3 — CAPABILITY DECISION MATRIX (LOCKED)

### 3.1 Financial Statements

| Capability | Business Core | Firm Leverage | Exclusive | Verdict |
|------------|---------------|---------------|-----------|---------|
| View P&L / BS / TB / GL | ✅ | ❌ | ❌ | Business must always see |
| Export P&L / BS / TB / GL (CSV/PDF) | ✅ | ❌ | ❌ | Portability is a right |
| Period-based snapshots | ✅ | ❌ | ❌ | Required for trust |
| Ledger drill-down | ✅ | ❌ | ❌ | Transparency |

**Finding:**  
Export UI for financial statements **belongs to Business Core**, not Firm.

---

### 3.2 Transaction-Level Data

| Capability | Business Core | Firm Leverage | Exclusive | Verdict |
|------------|---------------|---------------|-----------|---------|
| Journal list (read) | ✅ | ❌ | ❌ | Owner must inspect |
| Transaction CSV export | ⚠️ | ✅ | ❌ | Firm default, Business optional |
| VAT / tax line exports | ⚠️ | ✅ | ❌ | Firm default |
| Audit-ready transaction bundles | ❌ | ✅ | ❌ | Firm value |

**Finding:**  
Transaction exports are **legitimately firm-weighted**, but blocking owners entirely creates friction.

---

### 3.3 Period & Control Operations

| Capability | Business Core | Firm Leverage | Exclusive | Verdict |
|------------|---------------|---------------|-----------|---------|
| Period view (open/closed) | ✅ | ❌ | ❌ | Owner visibility |
| Period close | ❌ | ✅ | ❌ | Accountant-led |
| Period reopen | ❌ | ✅ | ❌ | High-risk action |
| Adjustments / carry-forward | ❌ | ✅ | ❌ | Professional control |
| Reconciliation resolve | ❌ | ✅ | ❌ | Separation of duties |

**Finding:**  
All **mutation of accounting state** should remain firm-led.

---

### 3.4 Workflow & Scale Features

| Capability | Business Core | Firm Leverage | Exclusive | Verdict |
|------------|---------------|---------------|-----------|---------|
| Multi-client dashboards | ❌ | ✅ | ❌ | Firm-only |
| Bulk exports | ❌ | ✅ | ❌ | Firm-only |
| Engagement management | ❌ | ✅ | ❌ | Firm-only |
| Review / approval chains | ❌ | ✅ | ❌ | Firm-only |
| Audit readiness workflows | ❌ | ✅ | ❌ | Firm-only |

**Finding:**  
This is Finza's **economic moat**.

---

## PART 4 — LEAKAGE & INCENTIVE ANALYSIS

### 4.1 If Business Gets Too Much
- Firms lose differentiation
- Accountants reduced to PDF recipients
- Finza loses B2B2B expansion

### 4.2 If Business Gets Too Little
- Businesses export via API hacks
- External tools re-enter workflow
- Trust erosion

### 4.3 Optimal Tension (Target State)
- **Business owns truth**
- **Firm owns workflow**
- **Finza owns the bridge**

---

## PART 5 — PHASE 9 ALIGNMENT SCORE

| Dimension | Score | Rationale |
|-----------|------|-----------|
| Business autonomy | 85% | Core visibility strong; export UI missing |
| Accountant leverage | 95% | Firm workflows strongly protected |
| Commercial defensibility | 90% | Firm moat intact |
| Trust & portability | 80% | API export exists, UI asymmetry remains |

**Overall Phase 9 Alignment:** **88%**

---

## FINAL LOCKED VERDICT

> Finza's strategic boundary is **mostly correct**: businesses fully own their accounting truth, firms control mutation and scale, and Accounting-First remains optional but powerful. The primary misalignment is **export ergonomics**, not authority — export UI for core financial statements belongs to the business surface, while transaction-level and workflow-heavy exports correctly remain firm-weighted.

---

## OUTPUT STATUS

- Phase 9 is **complete**
- Deterministic
- Vision-aligned
- No implementation prescribed
- Ready for executive decision or Phase 10 (Execution Sequencing)

---

**End of Phase 9.**
