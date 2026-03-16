# Partial Payment Alerts

## Overview

The partial payment alert system automatically notifies business owners when a payment is received that leaves an outstanding balance on an invoice. This helps identify partial payments without manual checks.

## Features

- **Automatic Detection**: Triggered when a payment is applied and outstanding_amount > 0
- **One Alert Per Payment**: Each payment event generates exactly one alert
- **Internal Notifications**: Alerts are visible to business owners only (not customers)
- **Non-Destructive**: Does not mark invoices as paid or change invoice status
- **Dashboard Integration**: Alerts displayed on dashboard for easy visibility

## Database Schema

### internal_alerts Table

- `id` (UUID): Primary key
- `business_id` (UUID): Business that owns the alert
- `alert_type` (TEXT): Type of alert ('partial_payment', 'other')
- `entity_type` (TEXT): Type of entity that triggered alert ('invoice', 'payment', etc.)
- `entity_id` (UUID): ID of the entity
- `invoice_id` (UUID): Related invoice
- `payment_id` (UUID): Related payment
- `title` (TEXT): Alert title
- `message` (TEXT): Alert message
- `metadata` (JSONB): Additional data (payment amount, outstanding amount, etc.)
- `is_read` (BOOLEAN): Whether alert has been read
- `read_at` (TIMESTAMP): When alert was marked as read
- `created_at` (TIMESTAMP): When alert was created
- `deleted_at` (TIMESTAMP): Soft delete timestamp

## How It Works

### 1. Trigger

When a payment is inserted into the `payments` table:

1. Database trigger `trigger_partial_payment_alert` fires
2. Function `create_partial_payment_alert()` executes
3. Calculates outstanding amount after payment:
   - Gets invoice total
   - Sums all payments (including new one)
   - Sums all applied credit notes
   - Calculates: `outstanding = total - payments - credits`

### 2. Alert Creation

If `outstanding_amount > 0`:
- Checks if alert already exists for this payment (prevents duplicates)
- Creates alert with:
  - Title: "Partial Payment Received"
  - Message: Includes invoice number, payment amount, outstanding balance
  - Metadata: JSON with invoice_number, payment_amount, outstanding_amount, etc.

### 3. Alert Display

- Alerts shown on dashboard via `AlertsPanel` component
- Shows unread alerts with details
- Links to invoice view page
- Can mark individual or all alerts as read

## Rules Enforced

1. ✅ **Only partial payments**: Alerts created only when outstanding > 0
2. ✅ **One alert per payment**: Duplicate prevention via database check
3. ✅ **Non-destructive**: Does not modify invoice status
4. ✅ **Payment-aware**: Uses actual payment calculations, not invoice status field
5. ✅ **Business-scoped**: Alerts only visible to business owners

## API Endpoints

### GET /api/alerts

**Query Parameters**:
- `unread_only` (boolean): If true, only return unread alerts
- `limit` (number): Maximum alerts to return (default: 50)

**Response**:
```json
{
  "alerts": [...],
  "unread_count": 5
}
```

### PUT /api/alerts

**Body**:
```json
{
  "alert_id": "uuid",  // Mark specific alert as read
  "mark_all_read": true  // Or mark all alerts as read
}
```

## UI Components

### AlertsPanel

Displays list of alerts with:
- Alert title and message
- Invoice number (clickable link)
- Payment details (amount, method)
- Outstanding balance
- Mark as read button
- "Mark all read" and "View all" buttons

**Usage**:
```tsx
<AlertsPanel maxAlerts={5} showAllButton={true} />
```

### AlertBadge

Shows unread count badge (for navigation/header).

**Usage**:
```tsx
<AlertBadge businessId={businessId} />
```

## Setup

1. Run migration: `081_add_partial_payment_alerts.sql`
2. Alerts will automatically be created when partial payments are received
3. Dashboard will display alerts automatically

## Future Enhancements

- Email notifications for alerts
- Alert preferences (which alert types to show)
- Alert filters (by date, invoice, etc.)
- Alert archiving
- Alert statistics
- Push notifications (browser notifications)













