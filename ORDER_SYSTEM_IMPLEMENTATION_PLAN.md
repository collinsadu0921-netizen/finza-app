# ORDER SYSTEM IMPLEMENTATION PLAN
## Finza - General Service & Professional Modes

**Version:** 1.0  
**Date:** 2025-01-XX  
**Scope:** Estimate → Order → Invoice workflow + Unified Document Templates

---

## TABLE OF CONTENTS

1. [Database Schema](#1-database-schema)
2. [Service Workflow](#2-service-workflow)
3. [API Routes](#3-api-routes)
4. [UI Pages & Components](#4-ui-pages--components)
5. [Buttons on Existing Pages](#5-buttons-on-existing-pages)
6. [Document Template Unification](#6-document-template-unification)
7. [Implementation Order](#7-implementation-order)
8. [Testing Checklist](#8-testing-checklist)

---

## 1. DATABASE SCHEMA

### 1.1 New Tables

#### `orders` Table

```sql
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  estimate_id UUID REFERENCES estimates(id) ON DELETE SET NULL,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  order_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'invoiced', 'cancelled')),
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_completion_date DATE,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  subtotal_before_tax NUMERIC NOT NULL DEFAULT 0,
  nhil_amount NUMERIC NOT NULL DEFAULT 0,
  getfund_amount NUMERIC NOT NULL DEFAULT 0,
  covid_amount NUMERIC NOT NULL DEFAULT 0,
  vat_amount NUMERIC NOT NULL DEFAULT 0,
  total_tax_amount NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  apply_taxes BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  public_token TEXT UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(business_id, order_number)
);
```

**Key Fields Explanation:**
- `estimate_id`: Links order to originating estimate (nullable - orders can be created standalone)
- `invoice_id`: Populated when order converts to invoice (nullable until conversion)
- `status`: Workflow states (`pending` → `active` → `completed` → `invoiced`)
- `order_number`: Auto-generated like `ORD-0001` (unique per business)
- `public_token`: For public order viewing (similar to invoices/estimates)
- Tax fields: Match invoice structure for Ghana tax calculation consistency

#### `order_items` Table

**Decision: Reuse `estimate_items` structure pattern**

```sql
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_service_id UUID REFERENCES products_services(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  qty NUMERIC NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  discount_amount NUMERIC NOT NULL DEFAULT 0,
  line_subtotal NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**Rationale for separate table:**
- Orders may have different quantities/prices than original estimate
- Allows order modification without affecting estimate history
- Consistent with `invoice_items` and `estimate_items` pattern
- Easier querying and status tracking

### 1.2 Indexes

```sql
CREATE INDEX idx_orders_business_id ON orders(business_id);
CREATE INDEX idx_orders_customer_id ON orders(customer_id);
CREATE INDEX idx_orders_estimate_id ON orders(estimate_id);
CREATE INDEX idx_orders_invoice_id ON orders(invoice_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_order_number ON orders(order_number);
CREATE INDEX idx_orders_public_token ON orders(public_token) WHERE public_token IS NOT NULL;
CREATE INDEX idx_orders_deleted_at ON orders(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_orders_business_id_created_at ON orders(business_id, created_at);

CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_order_items_product_service_id ON order_items(product_service_id);
```

### 1.3 Row Level Security (RLS)

Enable RLS on both tables with policies matching existing `estimates` and `invoices` patterns:

- Users can view/insert/update/delete orders for their business
- Users can view/insert/update/delete order_items for their business orders
- Use `business_users` table for authorization checks

### 1.4 Functions

#### Generate Order Number
```sql
CREATE OR REPLACE FUNCTION generate_order_number(business_uuid UUID)
RETURNS TEXT AS $$
DECLARE
  last_num INTEGER;
  new_num TEXT;
BEGIN
  SELECT COALESCE(
    MAX(CAST(SUBSTRING(order_number FROM 'ORD-(\d+)') AS INTEGER)),
    0
  ) INTO last_num
  FROM orders
  WHERE business_id = business_uuid AND deleted_at IS NULL;
  
  new_num := 'ORD-' || LPAD((last_num + 1)::TEXT, 4, '0');
  RETURN new_num;
END;
$$ LANGUAGE plpgsql;
```

#### Auto-update `updated_at` Trigger
```sql
CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_order_items_updated_at
  BEFORE UPDATE ON order_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

---

## 2. SERVICE WORKFLOW

### 2.1 Workflow Flowchart

```
Estimate (draft/sent) 
    ↓ [Convert to Order]
Order (pending)
    ↓ [Mark Active] (optional)
Order (active)
    ↓ [Mark Completed] (optional)
Order (completed)
    ↓ [Convert to Invoice]
Invoice (draft)
    ↓ [Send/Paid]
Invoice (sent/paid)
```

### 2.2 Workflow Rules

#### Rule 1: Estimate → Order Conversion
- **Source:** Estimate (status: `draft`, `sent`, or `accepted`)
- **Action:** Create new Order with:
  - Copy `customer_id` from estimate
  - Copy all `estimate_items` to `order_items` (snapshot at conversion time)
  - Copy tax calculations (subtotal, nhil, getfund, covid, vat, total)
  - Copy notes
  - Set `estimate_id` = source estimate ID
  - Set `status` = `pending`
  - Generate `order_number` using function
- **Estimate Status:** Update estimate status to `accepted` (if not already)
- **Validation:** Estimate must have at least one item

#### Rule 2: Order Status Transitions
- **`pending`**: Default when created from estimate or manually
- **`active`**: Work in progress (optional manual transition)
- **`completed`**: Work finished, ready for invoicing
- **`invoiced`**: Automatically set when converted to invoice
- **`cancelled`**: Order cancelled before completion
- **Allowed Transitions:**
  - `pending` → `active` → `completed` → `invoiced`
  - `pending` → `completed` → `invoiced` (skip active)
  - `pending` → `cancelled` (can't convert cancelled orders)
  - `active` → `cancelled`

#### Rule 3: Order → Invoice Conversion
- **Source:** Order (status: `pending`, `active`, or `completed`)
- **Action:** Create new Invoice with:
  - Copy `customer_id` from order
  - Copy all `order_items` to `invoice_items`
  - Copy tax calculations
  - Copy notes
  - Set `issue_date` = current date
  - Set `due_date` = `expected_completion_date` from order (if exists)
  - Generate `invoice_number` using existing function
  - Set invoice `status` = `draft`
- **Order Update:** 
  - Set `invoice_id` = new invoice ID
  - Set `status` = `invoiced` (automatically)
- **Validation:** Order must have at least one item, must not be cancelled or already invoiced

#### Rule 4: Direct Order Creation (No Estimate)
- Allow creating orders without estimates
- Set `estimate_id` = NULL
- Follow same validation as estimate conversion

---

## 3. API ROUTES

### 3.1 Route Structure

```
/api/orders/
  ├── create/route.ts              (POST - create new order)
  ├── list/route.ts                (GET - list orders with filters)
  ├── [id]/
  │   ├── route.ts                 (GET, PATCH - fetch/update order)
  │   ├── convert-to-invoice/route.ts  (POST - convert order to invoice)
  │   └── send/route.ts            (POST - send order to customer)
```

### 3.2 Endpoint Specifications

#### POST `/api/orders/create`

**Purpose:** Create a new order (standalone or from estimate)

**Request Body:**
```typescript
{
  customer_id?: string;           // Required if not from estimate
  estimate_id?: string;           // Optional - source estimate
  issue_date?: string;            // Optional - defaults to today
  expected_completion_date?: string;
  items: Array<{
    product_service_id?: string;
    description: string;
    qty: number;
    unit_price: number;
    discount_amount?: number;     // Optional, defaults to 0
  }>;
  apply_taxes?: boolean;          // Optional, defaults to true
  notes?: string;
}
```

**Response (Success 200):**
```typescript
{
  order: {
    id: string;
    order_number: string;
    status: string;
    customer_id: string | null;
    estimate_id: string | null;
    subtotal: number;
    total_tax_amount: number;
    total_amount: number;
    // ... all order fields
  };
  items: Array<{
    id: string;
    order_id: string;
    description: string;
    qty: number;
    unit_price: number;
    line_subtotal: number;
    // ... all item fields
  }>;
  message: "Order created successfully";
}
```

**Response (Error 400/500):**
```typescript
{
  error: string;
}
```

**Business Logic:**
1. Validate user authentication and business access
2. If `estimate_id` provided: validate estimate exists and belongs to business
3. Validate at least one item provided
4. Generate `order_number` using function
5. Calculate totals using Ghana tax engine (if `apply_taxes` = true)
6. Insert order and items in transaction
7. If from estimate: update estimate status to `accepted`
8. Generate `public_token` (UUID) for public viewing
9. Return order with items

---

#### GET `/api/orders/list`

**Purpose:** List all orders for business with filtering

**Query Parameters:**
```typescript
{
  status?: string;                // Filter by status
  customer_id?: string;           // Filter by customer
  estimate_id?: string;           // Filter by source estimate
  invoice_id?: string;            // Filter by converted invoice
  limit?: number;                 // Default: 50
  offset?: number;                // Default: 0
  search?: string;                // Search order_number, customer name
}
```

**Response (Success 200):**
```typescript
{
  orders: Array<{
    id: string;
    order_number: string;
    status: string;
    issue_date: string;
    total_amount: number;
    customers: {
      id: string;
      name: string;
      email: string | null;
    } | null;
    estimates: {
      id: string;
      estimate_number: string;
    } | null;
    invoices: {
      id: string;
      invoice_number: string;
    } | null;
  }>;
  total: number;                  // Total count for pagination
  limit: number;
  offset: number;
}
```

---

#### GET `/api/orders/[id]`

**Purpose:** Fetch single order with all details

**Response (Success 200):**
```typescript
{
  order: {
    id: string;
    order_number: string;
    status: string;
    // ... all order fields
    customers: {
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      address: string | null;
    } | null;
    estimates: {
      id: string;
      estimate_number: string;
      status: string;
    } | null;
    invoices: {
      id: string;
      invoice_number: string;
      status: string;
    } | null;
  };
  items: Array<{
    id: string;
    description: string;
    qty: number;
    unit_price: number;
    discount_amount: number;
    line_subtotal: number;
    products_services: {
      id: string;
      name: string;
    } | null;
  }>;
}
```

---

#### PATCH `/api/orders/[id]`

**Purpose:** Update order details (status, dates, notes, items)

**Request Body:**
```typescript
{
  status?: 'pending' | 'active' | 'completed' | 'cancelled';
  expected_completion_date?: string;
  notes?: string;
  items?: Array<{              // Replace all items
    product_service_id?: string;
    description: string;
    qty: number;
    unit_price: number;
    discount_amount?: number;
  }>;
}
```

**Business Logic:**
1. Validate status transition is allowed (see Rule 2)
2. If `items` provided: recalculate totals using tax engine
3. If status = `invoiced`: prevent updates (read-only)
4. Update `updated_at` automatically via trigger

**Response:** Same as GET `/api/orders/[id]`

---

#### POST `/api/orders/[id]/convert-to-invoice`

**Purpose:** Convert order to invoice

**Request Body:**
```typescript
{
  issue_date?: string;          // Optional - defaults to today
  due_date?: string;            // Optional - uses order.expected_completion_date
  invoice_number?: string;      // Optional - auto-generated if not provided
}
```

**Response (Success 200):**
```typescript
{
  invoice: {
    id: string;
    invoice_number: string;
    status: string;
    // ... all invoice fields
  };
  order: {
    id: string;
    status: 'invoiced';         // Updated status
    invoice_id: string;         // Link to new invoice
  };
  message: "Order converted to invoice successfully";
}
```

**Business Logic:**
1. Validate order exists and belongs to business
2. Validate order status is NOT `invoiced` or `cancelled`
3. Generate `invoice_number` if not provided
4. Create invoice and invoice_items in transaction
5. Update order: set `invoice_id` and `status = 'invoiced'`
6. Use existing invoice creation logic for tax calculations
7. Return invoice and updated order

---

#### POST `/api/orders/convert-from-estimate`

**Purpose:** Convert estimate directly to order (shortcut)

**Request Body:**
```typescript
{
  estimate_id: string;          // Required
  issue_date?: string;
  expected_completion_date?: string;
}
```

**Response:** Same as POST `/api/orders/create`

**Business Logic:**
1. Fetch estimate and items
2. Call order creation logic with estimate data
3. This is essentially a convenience wrapper around `POST /api/orders/create` with `estimate_id`

---

#### POST `/api/orders/[id]/send`

**Purpose:** Send order to customer (WhatsApp, Email, or Link)

**Request Body:**
```typescript
{
  sendWhatsApp?: boolean;
  sendEmail?: boolean;
  copyLink?: boolean;
}
```

**Response:**
```typescript
{
  message: "Order sent successfully";
  whatsappUrl?: string;         // If sendWhatsApp = true
  publicUrl?: string;           // If copyLink = true
}
```

**Business Logic:**
1. Generate or reuse `public_token` for order
2. Create public URL: `/order-public/[token]`
3. Similar to existing invoice/estimate send logic
4. Update order `sent_at` timestamp (new field may be needed)

---

## 4. UI PAGES & COMPONENTS

### 4.1 Page Structure

```
app/orders/
  ├── page.tsx                  (List all orders)
  ├── new/
  │   └── page.tsx              (Create new order)
  └── [id]/
      ├── view/
      │   └── page.tsx          (View order details)
      └── edit/
          └── page.tsx          (Edit order - optional)
```

### 4.2 Page Specifications

#### `/orders` (List Page)

**Features:**
- Table/list view of all orders
- Status badges (pending, active, completed, invoiced, cancelled)
- Search bar (order number, customer name)
- Filters:
  - Status dropdown
  - Customer dropdown
  - Date range picker
- Columns:
  - Order Number
  - Customer Name
  - Issue Date
  - Expected Completion
  - Status
  - Total Amount
  - Related Estimate (link if exists)
  - Related Invoice (link if exists)
  - Actions (View, Edit, Convert to Invoice - if not invoiced)

**Actions:**
- "New Order" button (top right)
- Click row → navigate to `/orders/[id]/view`
- Status filter → update list
- Pagination if > 50 orders

---

#### `/orders/new` (Create Page)

**Features:**
- Form to create new order
- Customer selector (dropdown/search)
- Optional: "Convert from Estimate" button (opens modal to select estimate)
- Line items table:
  - Add/remove rows
  - Product/Service selector or free text description
  - Quantity, Unit Price, Discount, Line Total (auto-calculated)
- Order details:
  - Issue Date (default: today)
  - Expected Completion Date (optional)
  - Apply Taxes checkbox (default: checked)
  - Notes (textarea)
- Totals section:
  - Subtotal (before tax)
  - Tax breakdown (NHIL, GETFund, COVID, VAT) - if taxes applied
  - Total Tax
  - Grand Total
- Action buttons:
  - "Save as Draft" (status: pending)
  - "Create Order" (status: pending)

**Validation:**
- Customer required
- At least one line item required
- All line items must have description, qty > 0, unit_price >= 0

---

#### `/orders/[id]/view` (View Page)

**Features:**
- Header:
  - Order Number (large)
  - Status badge
  - Action buttons row:
    - "Edit" (if status not invoiced)
    - "Send Order" (opens modal)
    - "Convert to Invoice" (if status not invoiced/cancelled)
    - "Mark Active" (if status = pending)
    - "Mark Completed" (if status = pending/active)
    - "Cancel Order" (if status = pending/active)
- Customer section:
  - Name, email, phone, address
- Order details:
  - Issue Date
  - Expected Completion Date
  - Status
- Line items table (read-only):
  - Description, Quantity, Unit Price, Discount, Line Total
- Totals section:
  - Subtotal, Tax breakdown, Total Tax, Grand Total
- Related documents:
  - Source Estimate (link if exists)
  - Converted Invoice (link if exists, show after conversion)
- Notes section (if exists)
- Activity History (using existing `ActivityHistory` component)
- Public link (if public_token exists)

**Actions:**
- "Convert to Invoice" button:
  - Opens confirmation modal
  - On confirm: POST to `/api/orders/[id]/convert-to-invoice`
  - On success: Redirect to `/invoices/[invoice_id]/view`
  - Show loading state during conversion
- Status change buttons:
  - Update order status via PATCH `/api/orders/[id]`
  - Refresh page data after update

---

#### `/orders/[id]/edit` (Edit Page - Optional)

**Features:**
- Similar to `/orders/new` but pre-populated
- Only editable if status is NOT `invoiced` or `cancelled`
- Warn if order is linked to invoice
- Save changes: PATCH `/api/orders/[id]`
- Cancel: Navigate back to view page

**Note:** This is optional - could handle editing inline on view page instead.

---

### 4.3 Components

#### `components/orders/OrderStatusBadge.tsx`
- Visual status indicator (color-coded badges)
- Props: `status: string`
- Returns: Styled badge component

#### `components/orders/ConvertOrderToInvoiceModal.tsx`
- Confirmation modal for order → invoice conversion
- Shows order summary
- Optional: allow setting invoice issue_date and due_date
- Props: `orderId: string`, `onSuccess: (invoiceId: string) => void`, `onClose: () => void`

#### `components/orders/SendOrderModal.tsx`
- Similar to `SendInvoiceModal`
- Options: WhatsApp, Email, Copy Link
- Props: `orderId: string`, `onClose: () => void`

#### `components/orders/OrderItemsTable.tsx`
- Reusable table for displaying order items
- Props: `items: OrderItem[]`, `editable?: boolean`, `onItemChange?: () => void`
- Used in new, view, and edit pages

---

## 5. BUTTONS ON EXISTING PAGES

### 5.1 `/estimates/[id]/view`

**Current State:**
- Has "Convert to Invoice" button (line 211-218)
- Button shows when `estimate.status === "accepted"`

**Required Changes:**

**Add new button: "Convert to Order"**

**Location:** Add next to existing "Convert to Invoice" button

**Button Logic:**
```typescript
{estimate.status !== 'rejected' && estimate.status !== 'expired' && (
  <button
    onClick={() => handleConvertToOrder()}
    className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
  >
    Convert to Order
  </button>
)}
```

**Handler Function:**
```typescript
const handleConvertToOrder = async () => {
  try {
    setLoading(true)
    const response = await fetch(`/api/orders/convert-from-estimate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estimate_id: estimateId })
    })

    const data = await response.json()
    
    if (response.ok) {
      router.push(`/orders/${data.order.id}/view`)
    } else {
      setToast({ message: data.error || "Failed to convert estimate", type: "error" })
    }
  } catch (error) {
    setToast({ message: "Error converting estimate", type: "error" })
  } finally {
    setLoading(false)
  }
}
```

**Visual Order:**
1. "Edit" (if draft)
2. "Send Estimate"
3. **"Convert to Order"** (NEW)
4. "Convert to Invoice" (if accepted)

---

### 5.2 `/orders/[id]/view`

**Add button: "Convert to Invoice"**

**Location:** In action buttons row (top right of page)

**Button Logic:**
```typescript
{order.status !== 'invoiced' && order.status !== 'cancelled' && (
  <button
    onClick={() => handleConvertToInvoice()}
    className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700"
  >
    Convert to Invoice
  </button>
)}
```

**Handler Function:**
```typescript
const handleConvertToInvoice = async () => {
  try {
    setLoading(true)
    const response = await fetch(`/api/orders/${orderId}/convert-to-invoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}) // Optional: pass issue_date, due_date
    })

    const data = await response.json()
    
    if (response.ok) {
      setToast({ message: "Order converted to invoice successfully", type: "success" })
      router.push(`/invoices/${data.invoice.id}/view`)
    } else {
      setToast({ message: data.error || "Failed to convert order", type: "error" })
    }
  } catch (error) {
    setToast({ message: "Error converting order", type: "error" })
  } finally {
    setLoading(false)
  }
}
```

**After Conversion:**
- Show success toast
- Redirect to new invoice view page
- Invoice page should show link back to source order

---

### 5.3 Dashboard Updates

**File:** `app/dashboard/page.tsx`

**Add to Service Mode Menu:**
```typescript
if (businessIndustry === "service") {
  return [
    {
      title: "Invoicing",
      items: [
        { label: "Create Invoice", route: "/invoices/new", icon: "📝" },
        { label: "All Invoices", route: "/invoices", icon: "📋" },
        { label: "Estimates", route: "/estimates", icon: "📄" },
        { label: "Orders", route: "/orders", icon: "📦" }, // NEW
        { label: "Recurring Invoices", route: "/recurring", icon: "🔄" },
      ],
    },
    // ... other sections
  ]
}
```

---

## 6. DOCUMENT TEMPLATE UNIFICATION

### 6.1 Current State

**Problem:**
- Invoice HTML template duplicated in:
  - `app/api/invoices/[id]/pdf-preview/route.ts` (lines 73-336)
  - `app/api/invoices/preview/route.ts` (lines 106-368)
- Estimate HTML likely duplicated or missing
- Credit Note HTML likely missing
- No unified template component

### 6.2 Solution: Unified Template Component

**Create:** `components/documents/DocumentTemplate.tsx`

**Purpose:** Single React component that renders all document types

**Props Interface:**
```typescript
interface DocumentTemplateProps {
  documentType: 'Estimate' | 'Order' | 'Invoice' | 'Credit Note';
  documentNumber: string;
  issueDate: string;
  expiryDate?: string;          // For estimates
  dueDate?: string;             // For invoices
  customer: {
    name: string;
    email?: string;
    phone?: string;
    address?: string;
  } | null;
  business: {
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    logo_url?: string;
    tax_id?: string;
    registration_number?: string;
  };
  items: Array<{
    description: string;
    qty: number;
    unit_price: number;
    discount_amount?: number;
    line_subtotal: number;
  }>;
  subtotal: number;
  subtotal_before_tax?: number;
  nhil_amount?: number;
  getfund_amount?: number;
  covid_amount?: number;
  vat_amount?: number;
  total_tax_amount?: number;
  total_amount: number;
  apply_taxes?: boolean;
  notes?: string;
  footer_message?: string;
  // Invoice-specific
  paymentLink?: string;
  qrCodeUrl?: string;
  paidAmount?: number;
  balanceDue?: number;
  // Credit Note-specific
  originalInvoiceNumber?: string;
  creditNoteDate?: string;
}
```

**Component Structure:**
```typescript
export default function DocumentTemplate(props: DocumentTemplateProps) {
  const {
    documentType,
    documentNumber,
    issueDate,
    // ... other props
  } = props;

  // Determine title and labels based on documentType
  const getLabels = () => {
    switch (documentType) {
      case 'Estimate':
        return {
          title: 'ESTIMATE',
          numberLabel: 'Estimate Number',
          dateLabel: 'Issue Date',
          expiryLabel: 'Expiry Date',
        };
      case 'Order':
        return {
          title: 'ORDER',
          numberLabel: 'Order Number',
          dateLabel: 'Issue Date',
          expiryLabel: 'Expected Completion',
        };
      case 'Invoice':
        return {
          title: 'INVOICE',
          numberLabel: 'Invoice Number',
          dateLabel: 'Issue Date',
          expiryLabel: 'Due Date',
        };
      case 'Credit Note':
        return {
          title: 'CREDIT NOTE',
          numberLabel: 'Credit Note Number',
          dateLabel: 'Date',
          expiryLabel: null,
        };
      default:
        return {};
    }
  };

  const labels = getLabels();

  return (
    <div className="document-container">
      {/* Header with logo and title */}
      {/* Customer and business details */}
      {/* Line items table */}
      {/* Totals section */}
      {/* Payment info (invoice only) */}
      {/* Notes and footer */}
    </div>
  );
}
```

**Styling:**
- Use Tailwind CSS classes (consistent with existing)
- Extract styles to shared CSS file if needed: `styles/document-template.css`
- Ensure print-friendly (use `@media print` queries)

---

### 6.3 API Route Updates

**Update:** `app/api/invoices/[id]/pdf-preview/route.ts`

**Before:**
```typescript
const htmlPreview = `<!DOCTYPE html>...`; // Hardcoded HTML string
return NextResponse.json({ htmlPreview });
```

**After:**
```typescript
import { renderToString } from 'react-dom/server';
import DocumentTemplate from '@/components/documents/DocumentTemplate';

// ... fetch invoice data ...

const htmlPreview = `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${labels.title} ${invoice.invoice_number}</title>
    <link rel="stylesheet" href="/styles/document-template.css">
  </head>
  <body>
    ${renderToString(
      <DocumentTemplate
        documentType="Invoice"
        documentNumber={invoice.invoice_number}
        issueDate={invoice.issue_date}
        dueDate={invoice.due_date}
        customer={invoice.customers}
        business={businessInfo}
        items={items}
        subtotal={invoice.subtotal}
        total_amount={invoice.total_amount}
        // ... all props
      />
    )}
  </body>
</html>
`;

return NextResponse.json({ htmlPreview });
```

**Alternative Approach (if SSR issues):**
- Keep HTML template in separate file: `templates/document-template.html`
- Use template engine (like Handlebars) to inject variables
- Less React-dependent, easier for PDF generation

---

### 6.4 PDF Generation

**Current State:**
- PDF endpoints return JSON (TODO comments indicate PDF library needed)

**Future Implementation:**
- Use `puppeteer` or `@react-pdf/renderer` or `pdfkit`
- Render `DocumentTemplate` component to PDF
- Or render HTML string to PDF using headless browser

**Recommended Library:**
- `@react-pdf/renderer` for React-native PDF rendering
- Or `puppeteer` for HTML-to-PDF conversion (more control)

**API Endpoints to Update:**
- `GET /api/invoices/[id]/pdf` → Return PDF blob
- `GET /api/orders/[id]/pdf` → Return PDF blob (new)
- `GET /api/estimates/[id]/pdf` → Return PDF blob (new)
- `GET /api/credit-notes/[id]/pdf` → Return PDF blob (new)

---

### 6.5 Public View Pages

**Update:** `app/invoice-public/[token]/page.tsx`

**Replace:** Inline HTML structure with `<DocumentTemplate>` component

**Create Similar Pages:**
- `app/order-public/[token]/page.tsx`
- `app/estimate-public/[token]/page.tsx`
- `app/credit-note-public/[token]/page.tsx`

All use the same `DocumentTemplate` component with different `documentType` prop.

---

### 6.6 Template File Structure

**Recommended:**
```
components/
  documents/
    DocumentTemplate.tsx        (Main unified component)
    DocumentTemplate.types.ts   (TypeScript interfaces)
    DocumentTemplate.css        (Optional - if custom styles needed)

templates/                      (Alternative approach)
  document-template.html        (HTML template with placeholders)

lib/
  documentTemplate.ts           (Helper functions for template logic)
```

---

## 7. IMPLEMENTATION ORDER

### Phase 1: Database Foundation ⚡ **CRITICAL FIRST STEP**

**Step 1.1:** Create Migration File
- File: `supabase/migrations/XXX_create_orders_table.sql`
- Create `orders` table with all fields
- Create `order_items` table
- Add indexes
- Enable RLS policies
- Create `generate_order_number()` function
- Create triggers for `updated_at`

**Step 1.2:** Test Migration
- Run migration locally
- Verify tables created
- Test RLS policies
- Test order number generation

**Time Estimate:** 2-3 hours

---

### Phase 2: Core API Endpoints 🔧

**Step 2.1:** Create Order API Structure
- Create `app/api/orders/` directory
- Create `create/route.ts`
- Create `list/route.ts`
- Create `[id]/route.ts` (GET, PATCH)
- Create `[id]/convert-to-invoice/route.ts`
- Create `convert-from-estimate/route.ts`

**Step 2.2:** Implement Order Creation
- `POST /api/orders/create`
- Handle standalone orders
- Handle estimate conversion
- Tax calculations using existing engine
- Validation and error handling

**Step 2.3:** Implement Order Listing
- `GET /api/orders/list`
- Filtering, pagination, search
- Join with customers, estimates, invoices

**Step 2.4:** Implement Order Fetch/Update
- `GET /api/orders/[id]`
- `PATCH /api/orders/[id]`
- Status transition validation

**Step 2.5:** Implement Conversion Endpoints
- `POST /api/orders/[id]/convert-to-invoice`
- `POST /api/orders/convert-from-estimate`
- Transaction safety (use database transactions)

**Step 2.6:** Testing
- Test each endpoint individually
- Test error cases
- Test RLS authorization

**Time Estimate:** 6-8 hours

---

### Phase 3: UI Pages 🎨

**Step 3.1:** Create Order Pages Structure
- Create `app/orders/` directory
- Create `page.tsx` (list)
- Create `new/page.tsx` (create)
- Create `[id]/view/page.tsx` (view)
- Create `[id]/edit/page.tsx` (optional)

**Step 3.2:** Implement Order List Page
- Table/list component
- Search and filters
- Status badges
- Navigation to view page

**Step 3.3:** Implement Order Create Page
- Form components
- Line items table (add/remove rows)
- Tax calculation display
- Save/create functionality

**Step 3.4:** Implement Order View Page
- Display all order details
- Action buttons (convert, edit, send, status changes)
- Related documents links
- Activity history

**Step 3.5:** Create Reusable Components
- `OrderStatusBadge.tsx`
- `OrderItemsTable.tsx`
- `ConvertOrderToInvoiceModal.tsx`
- `SendOrderModal.tsx`

**Time Estimate:** 8-10 hours

---

### Phase 4: Integration with Existing Pages 🔗

**Step 4.1:** Update Estimate View Page
- Add "Convert to Order" button
- Add handler function
- Update button layout

**Step 4.2:** Update Dashboard
- Add "Orders" menu item for Service/Professional modes
- Update menu structure

**Step 4.3:** Update Invoice View Page (Optional)
- Show link to source order (if `order_id` exists in invoice - may need migration)
- Or show in related documents section

**Step 4.4:** Update Sidebar Navigation (if applicable)
- Add Orders link to sidebar menu

**Time Estimate:** 2-3 hours

---

### Phase 5: Document Template Unification 📄

**Step 5.1:** Create Unified Template Component
- Create `components/documents/DocumentTemplate.tsx`
- Define props interface
- Implement conditional rendering based on `documentType`
- Extract shared styles

**Step 5.2:** Update Invoice Preview/PDF Routes
- Replace hardcoded HTML with `DocumentTemplate`
- Test invoice rendering

**Step 5.3:** Create Order Public View Page
- Create `app/order-public/[token]/page.tsx`
- Use `DocumentTemplate` with `documentType="Order"`

**Step 5.4:** Update Estimate Public View (if exists)
- Use `DocumentTemplate` with `documentType="Estimate"`

**Step 5.5:** Update Credit Note Views (if exists)
- Use `DocumentTemplate` with `documentType="Credit Note"`

**Step 5.6:** PDF Generation (Future)
- Install PDF library
- Update PDF endpoints to render `DocumentTemplate` to PDF
- Test PDF generation for all document types

**Time Estimate:** 6-8 hours

---

### Phase 6: Testing & Refinement 🧪

**Step 6.1:** End-to-End Workflow Testing
- Create Estimate → Convert to Order → Convert to Invoice
- Verify data integrity at each step
- Test status transitions
- Test error handling

**Step 6.2:** UI/UX Testing
- Test all pages in different screen sizes
- Test button interactions
- Test form validations
- Test loading states

**Step 6.3:** Integration Testing
- Test with existing invoice system
- Test with payment system
- Test with audit logging (if applicable)

**Step 6.4:** Performance Testing
- Test list page with many orders
- Test query performance
- Optimize if needed

**Time Estimate:** 4-6 hours

---

### Phase 7: Documentation & Cleanup 📚

**Step 7.1:** Code Comments
- Add JSDoc comments to API routes
- Add comments to complex logic

**Step 7.2:** Update API Documentation
- Document new endpoints
- Update existing documentation

**Step 7.3:** User Documentation (if needed)
- Update user guide with Order workflow
- Add screenshots if applicable

**Time Estimate:** 2-3 hours

---

### **TOTAL ESTIMATED TIME: 30-42 hours**

---

## 8. TESTING CHECKLIST

### 8.1 Database Tests

- [ ] Migration runs successfully
- [ ] RLS policies prevent unauthorized access
- [ ] Order number generation is sequential and unique
- [ ] Foreign key constraints work correctly
- [ ] Triggers update `updated_at` automatically

### 8.2 API Tests

- [ ] Create order (standalone)
- [ ] Create order from estimate
- [ ] List orders with filters
- [ ] Fetch single order
- [ ] Update order status
- [ ] Update order items (recalculate totals)
- [ ] Convert order to invoice
- [ ] Convert estimate to order
- [ ] Send order (WhatsApp, Email, Link)
- [ ] Error handling (invalid IDs, unauthorized access, validation errors)

### 8.3 Workflow Tests

- [ ] Estimate → Order → Invoice (full flow)
- [ ] Order status transitions (pending → active → completed → invoiced)
- [ ] Cannot convert cancelled order
- [ ] Cannot convert already-invoiced order
- [ ] Order data copied correctly to invoice
- [ ] Order status updated to "invoiced" after conversion

### 8.4 UI Tests

- [ ] Order list page loads and displays orders
- [ ] Search and filters work
- [ ] Create order page validates inputs
- [ ] Tax calculations display correctly
- [ ] Order view page shows all details
- [ ] Convert buttons work and redirect correctly
- [ ] Status change buttons work
- [ ] Public order view works (if implemented)

### 8.5 Template Tests

- [ ] DocumentTemplate renders correctly for all types
- [ ] Invoice preview uses unified template
- [ ] Order preview uses unified template
- [ ] Estimate preview uses unified template (if applicable)
- [ ] Credit Note preview uses unified template (if applicable)
- [ ] Template is responsive and print-friendly

### 8.6 Integration Tests

- [ ] Orders appear in dashboard menu
- [ ] Estimate view page has "Convert to Order" button
- [ ] Invoice created from order links back to order
- [ ] Activity history logs order actions (if applicable)
- [ ] Audit logging works (if applicable)

---

## 9. ADDITIONAL CONSIDERATIONS

### 9.1 Migration Strategy

- **Backward Compatibility:** Existing estimates can still convert directly to invoices (don't remove that button yet)
- **Data Migration:** No existing data to migrate (new feature)
- **Rollback Plan:** Migration can be rolled back by dropping `orders` and `order_items` tables

### 9.2 Performance Considerations

- **Indexes:** All foreign keys and commonly filtered fields are indexed
- **Pagination:** List endpoint supports limit/offset
- **Query Optimization:** Use `SELECT` only needed fields, use joins efficiently

### 9.3 Security Considerations

- **RLS:** All tables have RLS enabled
- **Validation:** Server-side validation for all inputs
- **Authorization:** Check business ownership for all operations
- **Public Tokens:** Use UUID for public tokens (hard to guess)

### 9.4 Future Enhancements

- **Order Tracking:** Add timeline/status history
- **Email Notifications:** Send emails when order status changes
- **Order Templates:** Save common order configurations
- **Bulk Operations:** Convert multiple orders to invoices
- **Order Analytics:** Dashboard widgets for order metrics

---

## 10. FILES TO CREATE/MODIFY

### New Files

**Database:**
- `supabase/migrations/XXX_create_orders_table.sql`

**API:**
- `app/api/orders/create/route.ts`
- `app/api/orders/list/route.ts`
- `app/api/orders/[id]/route.ts`
- `app/api/orders/[id]/convert-to-invoice/route.ts`
- `app/api/orders/[id]/send/route.ts`
- `app/api/orders/convert-from-estimate/route.ts`

**Pages:**
- `app/orders/page.tsx`
- `app/orders/new/page.tsx`
- `app/orders/[id]/view/page.tsx`
- `app/orders/[id]/edit/page.tsx` (optional)
- `app/order-public/[token]/page.tsx`

**Components:**
- `components/orders/OrderStatusBadge.tsx`
- `components/orders/OrderItemsTable.tsx`
- `components/orders/ConvertOrderToInvoiceModal.tsx`
- `components/orders/SendOrderModal.tsx`
- `components/documents/DocumentTemplate.tsx`

### Modified Files

**Pages:**
- `app/estimates/[id]/view/page.tsx` (add "Convert to Order" button)
- `app/dashboard/page.tsx` (add Orders menu item)
- `app/invoices/[id]/view/page.tsx` (show source order link - optional)

**API:**
- `app/api/invoices/[id]/pdf-preview/route.ts` (use DocumentTemplate)
- `app/api/invoices/preview/route.ts` (use DocumentTemplate)

**Components:**
- `components/Sidebar.tsx` (add Orders link - if applicable)

---

## END OF PLAN

**Next Steps:**
1. Review and approve this plan
2. Start with Phase 1 (Database Migration)
3. Proceed sequentially through phases
4. Test thoroughly at each phase
5. Deploy incrementally (database first, then API, then UI)

**Questions or Changes:**
- Update this document as requirements evolve
- Document any deviations from plan
- Keep implementation aligned with this roadmap

