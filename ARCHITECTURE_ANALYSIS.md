# Finza Architecture & Feature Analysis
## Complete System Feature Mapping by Mode

**Date**: 2025-01-XX  
**Purpose**: Comprehensive analysis of architecture, features per mode, feature connections, and tax engine pluggability

---

## 📋 TABLE OF CONTENTS

1. [Tax Engine Pluggability Analysis](#1-tax-engine-pluggability-analysis)
2. [Shared Core Features](#2-shared-core-features)
3. [Mode-Specific Features](#3-mode-specific-features)
4. [Feature Connections & Dependencies](#4-feature-connections--dependencies)
5. [Database Schema Architecture](#5-database-schema-architecture)
6. [System Architecture Patterns](#6-system-architecture-patterns)

---

## 1. TAX ENGINE PLUGGABILITY ANALYSIS

### ✅ **CONFIRMED: Tax Engine IS Pluggable**

**Evidence:**

#### 1.1 Architecture Design
- **Location**: `lib/taxEngine/`
- **Structure**: 
  ```
  lib/taxEngine/
  ├── index.ts              # Registry & entry point
  ├── types.ts              # Interface definitions
  ├── helpers.ts            # Utility functions
  └── jurisdictions/
      └── ghana.ts          # Ghana implementation
  ```

#### 1.2 Pluggability Mechanisms

**A. Registry Pattern**
```typescript
// lib/taxEngine/index.ts
const TAX_ENGINES: Record<string, TaxEngine> = {
  'GH': ghanaTaxEngine,
  'GHA': ghanaTaxEngine,
  // Future: 'US': usTaxEngine,
  // Future: 'KE': kenyaTaxEngine,
}
```

**B. Interface-Based Design**
- All tax engines implement `TaxEngine` interface
- Standardized methods: `calculateFromLineItems()`, `calculateFromAmount()`, `reverseCalculate()`
- Generic types: `TaxCalculationResult`, `TaxLine`, `TaxEngineConfig`

**C. Jurisdiction-Based Selection**
- Automatically selects engine based on business/store country
- Fallback to default (Ghana) if jurisdiction not found
- Normalizes country codes (e.g., "Ghana" → "GH")

**D. Versioned Tax Rules**
- Ghana engine supports versioned tax rates (pre/post 2026-01-01)
- COVID levy removed in Version B
- Easy to add new versions for any jurisdiction

#### 1.3 Adding New Jurisdiction

**Steps to Add New Tax Engine:**
1. Create `lib/taxEngine/jurisdictions/[country].ts`
2. Implement `TaxEngine` interface
3. Register in `TAX_ENGINES` map in `index.ts`
4. No changes needed to calling code

**Example:**
```typescript
// lib/taxEngine/jurisdictions/kenya.ts
export const kenyaTaxEngine: TaxEngine = {
  calculateFromLineItems(...) { /* Kenya logic */ },
  calculateFromAmount(...) { /* Kenya logic */ },
  reverseCalculate(...) { /* Kenya logic */ },
}

// lib/taxEngine/index.ts
const TAX_ENGINES: Record<string, TaxEngine> = {
  'GH': ghanaTaxEngine,
  'KE': kenyaTaxEngine, // ← Just add this line
}
```

#### 1.4 Current Usage Status

**Migration in Progress:**
- ✅ **New System**: Used in invoices, POS, estimates, orders (9 files)
- ⚠️ **Legacy System**: Still used in bills, expenses, credit notes (19 files)
- **Legacy File**: `lib/ghanaTaxEngine.ts` (hardcoded Ghana logic)

**Recommendation**: Complete migration to pluggable system for consistency.

---

## 2. SHARED CORE FEATURES

### Features Available in ALL Modes

#### 2.1 Business Management
- ✅ Business Profile (`businesses` table)
- ✅ Business Settings
- ✅ Multi-business support (via `business_users` table)
- ✅ Business ownership tracking (`businesses.owner_id`)

#### 2.2 User & Access Control
- ✅ User authentication (Supabase Auth)
- ✅ Role-based access control (admin, manager, cashier, employee, accountant)
- ✅ Business-user relationships (`business_users` table)
- ✅ PIN code authentication (for cashiers)
- ✅ Session management

#### 2.3 Products & Services
- ✅ Product management (`products` table)
- ✅ Product categories (`categories` table)
- ✅ Product variants (`products_variants` table)
- ✅ Product modifiers (`product_modifiers` table)
- ✅ Barcode support
- ✅ Product images
- ✅ COGS tracking
- ✅ Bulk import (CSV)

#### 2.4 Tax Engine
- ✅ Pluggable tax calculation
- ✅ Ghana tax support (NHIL, GETFund, COVID, VAT)
- ✅ Tax-inclusive/exclusive modes
- ✅ Reverse tax calculation
- ✅ VAT reporting

#### 2.5 Financial & Accounting
- ✅ Chart of Accounts (`chart_of_accounts` table)
- ✅ General Ledger (`general_ledger` table)
- ✅ Journal Entries (`journal_entries` table)
- ✅ Trial Balance
- ✅ Profit & Loss reports
- ✅ Balance Sheet reports
- ✅ VAT Returns
- ✅ Credit Notes
- ✅ Supplier Bills
- ✅ Expenses
- ✅ Payroll system
- ✅ Asset Register
- ✅ Reconciliation

#### 2.6 Reporting
- ✅ Financial reports
- ✅ VAT reports
- ✅ Date range filtering
- ✅ Export capabilities

#### 2.7 Integrations
- ✅ WhatsApp integration
- ✅ Email automation
- ✅ Receipt printing (browser + ESC/POS)

#### 2.8 Settings & Configuration
- ✅ Payment settings
- ✅ Invoice settings
- ✅ Automation settings
- ✅ Staff management

---

## 3. MODE-SPECIFIC FEATURES

### 3.1 RETAIL MODE (`industry = "retail"`)

#### Unique Features
- ✅ **POS Terminal** (`/pos`)**
  - Cart management
  - Real-time tax calculation
  - Multiple payment methods (Cash, MoMo, Card, Split)
  - Receipt printing
  - Barcode scanning
  - Parked sales
  - Sale voiding (with approval)
  - Refunds (with approval)

- ✅ **Register Sessions** (`cashier_sessions` table)**
  - Open/close register sessions
  - Opening float tracking
  - Cash variance tracking
  - Register-based sessions (multiple registers per store)
  - Session reports

- ✅ **Multi-Store Support** (`stores` table)**
  - Store management
  - Per-store inventory (`products_stock` table)
  - Store switching
  - Store-specific registers
  - Store-specific staff assignment

- ✅ **Inventory Management**
  - Per-store stock tracking
  - Stock movements (`stock_history` table)
  - Low stock alerts
  - Inventory dashboard
  - Stock history reports

- ✅ **Sales Management**
  - Sales history (`sales` table)
  - Sales items (`sale_items` table)
  - Register reports
  - Cash office reports
  - Analytics dashboard

- ✅ **Retail-Specific Tables**
  - `stores` - Store locations
  - `registers` - Cash registers
  - `cashier_sessions` - Register sessions
  - `sales` - Sales transactions
  - `sale_items` - Sale line items
  - `products_stock` - Per-store inventory
  - `stock_history` - Stock movements

#### Why These Features Are Retail-Only
- **POS Terminal**: Retail needs real-time transaction processing
- **Register Sessions**: Retail requires cash drawer management
- **Multi-Store**: Retail businesses often have multiple locations
- **Inventory**: Retail needs real-time stock tracking per location

---

### 3.2 SERVICE MODE (`industry = "service"`)

#### Unique Features
- ✅ **Invoice System** (`invoices` table)**
  - Create/edit invoices
  - Invoice numbering
  - Invoice status (draft, sent, paid, overdue, cancelled)
  - Invoice templates
  - Public invoice links
  - Invoice PDF generation

- ✅ **Client Management** (`customers` table)**
  - Client profiles
  - Client contact information
  - Client payment terms
  - Client notes

- ✅ **Estimates** (`estimates` table)**
  - Create estimates
  - Convert estimates to invoices
  - Estimate templates

- ✅ **Orders** (`orders` table)**
  - Order management
  - Estimate → Order → Invoice workflow
  - Order status tracking
  - Order completion tracking

- ✅ **Recurring Invoices** (`recurring_invoices` table)**
  - Automated invoice generation
  - Recurring schedules
  - Auto-send functionality

- ✅ **Payments** (`payments` table)**
  - Payment recording
  - Payment methods
  - Payment allocation to invoices
  - Payment receipts

- ✅ **Service-Specific Tables**
  - `invoices` - Invoices
  - `invoice_items` - Invoice line items
  - `customers` - Clients
  - `estimates` - Estimates
  - `estimate_items` - Estimate line items
  - `orders` - Orders
  - `order_items` - Order line items
  - `recurring_invoices` - Recurring invoices
  - `payments` - Payments
  - `payment_allocations` - Payment-to-invoice allocations

#### Why These Features Are Service-Only
- **Invoices**: Service businesses bill clients after work completion
- **Estimates**: Service businesses quote before work
- **Orders**: Service businesses track work orders
- **Recurring Invoices**: Service businesses have subscription clients

---

### 3.3 PROFESSIONAL MODE (`industry = "professional"`)

#### Features
- ✅ **Same as Service Mode** (uses identical features)
- ✅ **Professional Services Focus**
  - Client management
  - Invoice-based billing
  - Professional service tracking

#### Why Professional = Service
- Professional services follow same workflow as general services
- Both are invoice-based, not transaction-based
- Same accounting needs
- Same client management needs

**Difference**: Only in UI/UX presentation and onboarding flow

---

### 3.4 LOGISTICS MODE (`industry = "logistics"`)

#### Unique Features
- ✅ **Rider Management** (`riders` table)**
  - Rider profiles
  - Rider status tracking
  - Rider assignment

- ✅ **Delivery Management** (`deliveries` table)**
  - Delivery tracking
  - Delivery status
  - Delivery pricing
  - Delivery completion

- ✅ **Pricing System** (`rider_pricing` table)**
  - Distance-based pricing
  - Tier-based pricing
  - Pricing rules

- ✅ **Rider Dashboard**
  - Delivery dashboard
  - Rider performance
  - Delivery analytics

- ✅ **Logistics-Specific Tables**
  - `riders` - Delivery riders
  - `deliveries` - Delivery orders
  - `rider_pricing` - Pricing rules
  - `rider_payouts` - Rider payments
  - `rider_distance_tiers` - Distance pricing tiers

#### Why These Features Are Logistics-Only
- **Rider Management**: Logistics businesses manage delivery personnel
- **Delivery Tracking**: Logistics businesses track deliveries
- **Pricing System**: Logistics businesses price by distance/time

---

## 4. FEATURE CONNECTIONS & DEPENDENCIES

### 4.1 Why Features Are Connected

#### A. Shared Database Tables
**Connected Because**: Same underlying data model

**Examples:**
- `products` - Used by Retail (POS), Service (invoices), Professional (invoices)
- `categories` - Used by all modes for product organization
- `businesses` - Core table for all modes
- `users` - User management for all modes
- `business_users` - Access control for all modes

#### B. Shared Business Logic
**Connected Because**: Common functionality across modes

**Examples:**
- **Tax Engine**: Used by Retail (POS sales), Service (invoices), Professional (invoices)
- **Chart of Accounts**: Used by all modes for accounting
- **General Ledger**: Used by all modes for financial tracking
- **VAT Returns**: Used by all modes for tax compliance

#### C. Mode-Specific Extensions
**Connected Because**: Extend shared features for mode-specific needs

**Examples:**
- **Products**:
  - Retail: Adds `products_stock` (per-store inventory)
  - Service: Uses products in invoices
  - Professional: Uses products in invoices
  - Logistics: Not used (deliveries don't need products)

- **Tax Calculation**:
  - Retail: Applied to POS sales
  - Service: Applied to invoices
  - Professional: Applied to invoices
  - Logistics: Not used (deliveries priced by distance)

### 4.2 Why Features Are NOT Connected

#### A. Different Business Models
**Not Connected Because**: Different operational needs

**Examples:**
- **Register Sessions** (Retail only):
  - Service/Professional: Don't need cash drawers
  - Logistics: Don't need cash drawers

- **Invoices** (Service/Professional only):
  - Retail: Uses sales transactions instead
  - Logistics: Uses delivery orders instead

- **Rider Management** (Logistics only):
  - Retail: Doesn't manage delivery personnel
  - Service: Doesn't manage delivery personnel

#### B. Different Data Flows
**Not Connected Because**: Different transaction patterns

**Examples:**
- **Retail Flow**: Product → Cart → Sale → Payment → Receipt
- **Service Flow**: Client → Estimate → Order → Invoice → Payment
- **Logistics Flow**: Delivery Request → Rider Assignment → Delivery → Payment

#### C. Different User Interfaces
**Not Connected Because**: Different user workflows

**Examples:**
- **Retail**: POS terminal interface
- **Service**: Invoice management interface
- **Logistics**: Delivery dashboard interface

---

## 5. DATABASE SCHEMA ARCHITECTURE

### 5.1 Core Tables (All Modes)

```sql
-- Business & User Management
businesses          -- Core business data
users               -- User accounts
business_users      -- Business-user relationships (roles)

-- Products (Shared)
products            -- Product catalog
categories          -- Product categories
products_variants   -- Product variants
product_modifiers   -- Product modifiers

-- Accounting (Shared)
chart_of_accounts  -- Chart of accounts
general_ledger     -- General ledger entries
journal_entries    -- Journal entries
```

### 5.2 Retail-Specific Tables

```sql
-- Retail Operations
stores              -- Store locations
registers           -- Cash registers
cashier_sessions    -- Register sessions
sales               -- Sales transactions
sale_items          -- Sale line items
products_stock      -- Per-store inventory
stock_history       -- Stock movements
```

### 5.3 Service/Professional Tables

```sql
-- Service Operations
customers           -- Clients
invoices            -- Invoices
invoice_items       -- Invoice line items
estimates           -- Estimates
estimate_items      -- Estimate line items
orders              -- Orders
order_items         -- Order line items
recurring_invoices  -- Recurring invoices
payments            -- Payments
payment_allocations -- Payment allocations
```

### 5.4 Logistics Tables

```sql
-- Logistics Operations
riders              -- Delivery riders
deliveries           -- Delivery orders
rider_pricing        -- Pricing rules
rider_payouts        -- Rider payments
rider_distance_tiers -- Distance pricing
```

### 5.5 Shared Financial Tables

```sql
-- Financial (All Modes)
credit_notes        -- Credit notes
bills               -- Supplier bills
expenses            -- Expenses
payroll             -- Payroll
assets              -- Asset register
```

---

## 6. SYSTEM ARCHITECTURE PATTERNS

### 6.1 Mode Detection Pattern

**Implementation**: `lib/industryMode.ts`
- Tab-scoped industry mode (sessionStorage)
- Initialized from database on first load
- Never overwrites once set (per tab)

**Usage**:
```typescript
const industry = getTabIndustryMode() // 'retail' | 'service' | 'professional' | 'logistics'
```

### 6.2 Feature Gating Pattern

**Implementation**: Conditional rendering based on `business.industry`

**Example**:
```typescript
// components/Sidebar.tsx
if (businessIndustry === "retail") {
  return <RetailMenu />
} else if (businessIndustry === "service" || businessIndustry === "professional") {
  return <ServiceMenu />
} else if (businessIndustry === "logistics") {
  return <LogisticsMenu />
}
```

### 6.3 Shared Component Pattern

**Implementation**: Components shared across modes with mode-specific behavior

**Examples**:
- `ProductForm` - Used by all modes, but Retail adds inventory fields
- `TaxCalculator` - Used by all modes, but different contexts (POS vs Invoice)
- `PaymentForm` - Used by all modes, but different payment types

### 6.4 Data Isolation Pattern

**Implementation**: All tables include `business_id` for multi-tenancy

**Example**:
```sql
CREATE TABLE invoices (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id),
  -- ... other fields
)
```

### 6.5 Tax Engine Pattern

**Implementation**: Pluggable tax engine with jurisdiction registry

**Flow**:
1. Business/store country → Jurisdiction code
2. Jurisdiction code → Tax engine selection
3. Tax engine → Tax calculation
4. Result → Standardized format

---

## 7. FEATURE COMPLETENESS SUMMARY

### ✅ Fully Implemented Features

#### Retail Mode
- ✅ POS Terminal
- ✅ Register Sessions
- ✅ Multi-Store
- ✅ Inventory Management
- ✅ Sales Tracking
- ✅ VAT Calculation
- ✅ Receipt Printing

#### Service/Professional Mode
- ✅ Invoice System
- ✅ Client Management
- ✅ Estimates
- ✅ Orders
- ✅ Recurring Invoices
- ✅ Payments
- ✅ Full Accounting Suite

#### Logistics Mode
- ✅ Rider Management
- ✅ Delivery Tracking
- ✅ Pricing System
- ✅ Rider Dashboard

#### All Modes
- ✅ Tax Engine (pluggable)
- ✅ Chart of Accounts
- ✅ General Ledger
- ✅ Financial Reports
- ✅ VAT Returns
- ✅ User Management
- ✅ Role-Based Access

### ⚠️ Partially Implemented Features

- ⚠️ **Tax Engine Migration**: New pluggable system exists but legacy code still in use
- ⚠️ **Customer Management in POS**: Basic support, needs enhancement
- ⚠️ **Offline Mode**: Not implemented
- ⚠️ **Advanced Reporting**: Basic reports exist, advanced analytics missing

### ❌ Missing Features

#### Retail Mode
- ❌ Customer loyalty programs
- ❌ Gift cards
- ❌ Advanced discounts (BOGO, volume)
- ❌ Layaway/installments
- ❌ Supplier management
- ❌ Purchase orders
- ❌ Email/SMS receipts
- ❌ Offline POS mode

#### Service/Professional Mode
- ❌ Advanced client segmentation
- ❌ Client credit limits
- ❌ Automated payment reminders (basic exists, needs enhancement)
- ❌ Multi-currency support

#### Logistics Mode
- ❌ Real-time GPS tracking
- ❌ Route optimization
- ❌ Delivery time windows
- ❌ Customer delivery preferences

---

## 8. ARCHITECTURE STRENGTHS

### ✅ Strengths

1. **Pluggable Tax Engine**: Well-designed, easy to extend
2. **Mode Isolation**: Clear separation of mode-specific features
3. **Shared Core**: Efficient reuse of common functionality
4. **Multi-Tenancy**: Proper business isolation
5. **Role-Based Access**: Comprehensive permission system
6. **Database Design**: Normalized, well-structured schema

### ⚠️ Areas for Improvement

1. **Tax Engine Migration**: Complete migration from legacy to pluggable system
2. **Feature Parity**: Some modes have features others could benefit from
3. **Code Duplication**: Some shared logic duplicated across modes
4. **Documentation**: Architecture patterns not fully documented

---

## 9. CONCLUSION

### Tax Engine Pluggability: ✅ **CONFIRMED**

The tax engine **IS pluggable** with:
- ✅ Registry-based jurisdiction selection
- ✅ Interface-based design
- ✅ Easy to add new jurisdictions
- ✅ Versioned tax rules support
- ⚠️ Migration in progress (legacy code still exists)

### Feature Architecture: ✅ **WELL-DESIGNED**

- ✅ Clear separation of mode-specific features
- ✅ Efficient sharing of common features
- ✅ Proper data isolation
- ✅ Extensible design patterns

### System Completeness: ✅ **PRODUCTION-READY**

- ✅ Core features implemented for all modes
- ✅ Tax engine pluggable and extensible
- ✅ Architecture supports future growth
- ⚠️ Some advanced features missing (not critical for MVP)

---

**Document Version**: 1.0  
**Last Updated**: 2025-01-XX  
**Status**: Complete Analysis




