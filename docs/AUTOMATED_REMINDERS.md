# Automated Invoice Reminder System

## Overview

The automated reminder system sends email reminders to customers for overdue invoices, with configurable intervals and automatic stopping when invoices are fully paid.

## Features

1. **Automatic Email Reminders**: Sends email reminders for overdue invoices
2. **Interval-Based**: Configurable reminder interval (default: 7 days)
3. **Payment-Aware**: Automatically stops reminders when invoice is fully paid
4. **Derived Payment State**: Uses actual payment/credit note calculations, not just invoice status
5. **Customizable Templates**: Email template with placeholders for personalization

## Database Schema

### business_reminder_settings

- `email_reminders_enabled` (boolean): Enable/disable automated email reminders
- `reminder_interval_days` (integer): Days between reminders (default: 7)
- `email_reminder_template` (text): Email template with placeholders

### invoice_reminders

- `reminder_method` (text): 'email', 'whatsapp', or 'both'
- `sent_at` (timestamp): When reminder was sent
- `next_reminder_date` (date): When next reminder should be sent (NULL if invoice is paid)

## How It Works

### 1. Trigger Condition

An invoice becomes overdue when:
- `due_date < today` AND
- `outstanding_amount > 0` (calculated from: invoice.total - payments - credit_notes)

### 2. Reminder Schedule

- **First Reminder**: Sent immediately when invoice becomes overdue
- **Subsequent Reminders**: Sent every N days (configurable, default 7) while invoice remains overdue
- **Automatic Stop**: When invoice is fully paid (outstanding_amount = 0), `next_reminder_date` is set to NULL

### 3. Processing

The automated endpoint (`/api/reminders/process-automated`) should be called daily by a cron job:

1. Finds all businesses with email reminders enabled
2. For each business, finds overdue invoices using derived payment state
3. Checks if reminder should be sent (based on `next_reminder_date`)
4. Sends email reminder to customer
5. Records reminder and calculates next reminder date
6. Skips if customer has no email address

## Setup

### 1. Run Migrations

Run the database migrations:
- `079_add_email_reminder_automation.sql`
- `080_stop_reminders_when_paid.sql`

### 2. Configure Reminder Settings

Users can configure reminders in Settings → Reminders:
- Enable/disable email reminders
- Set reminder interval (1-30 days)
- Customize email template

### 3. Set Up Cron Job

The automated endpoint must be called regularly (recommended: daily). Options:

#### Option A: Vercel Cron Jobs

Add to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/reminders/process-automated",
      "schedule": "0 9 * * *"
    }
  ]
}
```

#### Option B: External Cron Service

Use a service like cron-job.org or EasyCron to call:
```
POST https://your-domain.com/api/reminders/process-automated
Authorization: Bearer YOUR_API_KEY
```

Set the `REMINDER_API_KEY` environment variable for security.

#### Option C: Supabase Edge Functions

Create a scheduled Edge Function that calls the endpoint.

## API Endpoint

### POST /api/reminders/process-automated

**Authentication**: Bearer token (REMINDER_API_KEY)

**Response**:
```json
{
  "success": true,
  "processed": 10,
  "reminders_sent": 3,
  "errors": []
}
```

## Email Template Placeholders

- `{{customer_name}}` - Customer's name
- `{{invoice_number}}` - Invoice number
- `{{outstanding_amount}}` - Outstanding balance
- `{{due_date}}` - Invoice due date
- `{{invoice_url}}` - Public invoice URL
- `{{currency_symbol}}` - Currency symbol (currently ₵)

## Rules Enforced

1. ✅ **No reminders for paid invoices**: Calculates outstanding amount using payments + credit notes
2. ✅ **Respects derived payment state**: Doesn't rely on invoice.status field
3. ✅ **Interval-based**: Reminders sent at configured intervals (default 7 days)
4. ✅ **Automatic stop**: Reminders stop immediately when invoice is fully paid
5. ✅ **User configurable**: Can be disabled per business

## Future Enhancements

- Integrate actual email service (Resend, SendGrid, etc.)
- Add PDF invoice attachment to reminder emails
- Support multiple reminder methods (email + WhatsApp)
- Add reminder history/logs UI
- Support different reminder intervals based on days past due
- Add reminder statistics and analytics













