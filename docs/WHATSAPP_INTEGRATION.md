# WhatsApp Integration Guide

This document describes the WhatsApp Cloud API integration for Finza, allowing businesses to connect their WhatsApp Business number and send invoices directly to customers.

## Overview

The WhatsApp integration uses Meta's WhatsApp Cloud API to enable businesses to send invoices via WhatsApp. The integration follows OAuth 2.0 flow to securely connect a Meta Business Account and WhatsApp Business number.

## Features

- **OAuth Connection**: Secure OAuth flow to connect Meta Business Account
- **Connection Management**: Settings page to connect/disconnect WhatsApp
- **UI Gating**: WhatsApp sending options are disabled if not connected
- **Security**: Access tokens stored securely (encrypted at application level)

## Setup Requirements

### 1. Meta Developer Account Setup

1. Create a Meta App at https://developers.facebook.com/
2. Add WhatsApp product to your app
3. Get your App ID and App Secret
4. Configure OAuth redirect URI: `{YOUR_APP_URL}/api/whatsapp/callback`
5. Request required permissions:
   - `whatsapp_business_management`
   - `business_management`

### 2. Environment Variables

Add the following to your `.env.local`:

```env
META_WHATSAPP_APP_ID=your_app_id_here
META_WHATSAPP_APP_SECRET=your_app_secret_here
NEXT_PUBLIC_APP_URL=http://localhost:3000  # or your production URL
```

### 3. Database Migration

Run the migration to add WhatsApp connection fields:

```bash
# The migration file is: supabase/migrations/082_add_whatsapp_connection.sql
```

The migration adds the following columns to the `businesses` table:
- `whatsapp_connected` (boolean)
- `whatsapp_business_id` (text)
- `whatsapp_phone_number_id` (text)
- `whatsapp_phone_number` (text)
- `whatsapp_access_token_encrypted` (text)
- `whatsapp_token_expires_at` (timestamp)

## Usage

### Connecting WhatsApp

1. Navigate to **Settings → Integrations → WhatsApp**
2. Click **"Connect WhatsApp"**
3. You'll be redirected to Meta to authorize Finza
4. Select your Meta Business Account
5. Select your WhatsApp Business phone number
6. You'll be redirected back to Finza with connection established

### Disconnecting WhatsApp

1. Navigate to **Settings → Integrations → WhatsApp**
2. Click **"Disconnect WhatsApp"**
3. Confirm disconnection
4. All WhatsApp credentials will be cleared

### Sending Invoices

Once connected:
1. Open any invoice
2. Click **"Send Invoice"**
3. Select **"WhatsApp"** or **"Both"** from the send method dropdown
4. Click **"Send Invoice"**

**Note**: WhatsApp sending options are automatically disabled if:
- WhatsApp is not connected
- Customer phone number is not available

## API Endpoints

### GET `/api/whatsapp/connect`
Initiates OAuth flow. Redirects user to Meta authorization.

### GET `/api/whatsapp/callback`
OAuth callback handler. Processes authorization code, exchanges for access token, and stores connection details.

### POST `/api/whatsapp/disconnect`
Disconnects WhatsApp for current business. Clears all stored credentials.

### GET `/api/whatsapp/status`
Returns WhatsApp connection status for current business (does not expose access token).

## Security Considerations

### Token Storage

Access tokens are currently stored as plain text in the database (`whatsapp_access_token_encrypted` column). **This should be encrypted before production use.**

Recommended approaches:
1. **Supabase Vault**: Use Supabase Vault to encrypt sensitive data
2. **Application-level encryption**: Encrypt tokens before storing using a library like `crypto-js`
3. **Environment variables**: For single-business setups, consider storing in environment variables

### Token Refresh

Currently, the integration uses short-lived tokens. To implement token refresh:

1. Monitor `whatsapp_token_expires_at`
2. Before expiration, call Meta's token refresh endpoint
3. Update stored token and expiration time

## Future Enhancements

- [ ] Implement token encryption
- [ ] Add token refresh mechanism
- [ ] Allow user to select which Meta Business Account to use (if multiple)
- [ ] Allow user to select which WhatsApp number to use (if multiple)
- [ ] Implement actual WhatsApp API sending (currently uses wa.me links)
- [ ] Add webhook handling for delivery receipts
- [ ] Support template messages

## Troubleshooting

### "WhatsApp integration not configured"
- Ensure `META_WHATSAPP_APP_ID` and `META_WHATSAPP_APP_SECRET` are set in environment variables

### "No Meta Business accounts found"
- Ensure the Meta account used has access to a Business Account
- Check Meta Business Manager: https://business.facebook.com/

### "No WhatsApp phone numbers found"
- Ensure the Business Account has a verified WhatsApp Business number
- Check WhatsApp Manager: https://business.facebook.com/wa/manage/home/

### OAuth redirect errors
- Verify the redirect URI matches exactly in Meta App settings
- Ensure `NEXT_PUBLIC_APP_URL` matches your actual application URL

## Related Files

- **Migration**: `supabase/migrations/082_add_whatsapp_connection.sql`
- **OAuth Connect**: `app/api/whatsapp/connect/route.ts`
- **OAuth Callback**: `app/api/whatsapp/callback/route.ts`
- **Disconnect**: `app/api/whatsapp/disconnect/route.ts`
- **Status**: `app/api/whatsapp/status/route.ts`
- **Settings Page**: `app/settings/integrations/whatsapp/page.tsx`
- **Send Modal**: `components/invoices/SendInvoiceModal.tsx`
- **Send Dropdown**: `components/invoices/SendMethodDropdown.tsx`













