# WhatsApp Integration Quick Setup

## Step 1: Create Meta WhatsApp App

1. Go to https://developers.facebook.com/
2. Click **"My Apps"** → **"Create App"**
3. Select **"Business"** as the app type
4. Fill in app details and create the app
5. In the app dashboard, click **"Add Product"** → **"WhatsApp"**
6. Complete the WhatsApp setup wizard

## Step 2: Get Your Credentials

1. In your Meta App dashboard, go to **Settings → Basic**
2. Copy your **App ID** (you'll need this)
3. Copy your **App Secret** (click "Show" to reveal it)

## Step 3: Configure OAuth Redirect URI

1. In your Meta App dashboard, go to **Products → WhatsApp → Configuration**
2. Under **"Webhooks"** or **"Settings"**, find **"OAuth Redirect URIs"**
3. Add this redirect URI:
   ```
   http://localhost:3000/api/whatsapp/callback
   ```
   (For production, use your actual domain: `https://yourdomain.com/api/whatsapp/callback`)

## Step 4: Add Environment Variables

Create or edit `.env.local` in your project root:

```env
META_WHATSAPP_APP_ID=your_app_id_here
META_WHATSAPP_APP_SECRET=your_app_secret_here
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**Replace:**
- `your_app_id_here` with your actual App ID from Step 2
- `your_app_secret_here` with your actual App Secret from Step 2

## Step 5: Restart Your Dev Server

After adding the environment variables:

1. Stop your dev server (Ctrl+C)
2. Restart it: `npm run dev`
3. The environment variables will be loaded

## Step 6: Test the Connection

1. Go to **Settings → Integrations → WhatsApp**
2. Click **"Connect WhatsApp"**
3. You should be redirected to Meta to authorize
4. After authorization, you'll be redirected back to Finza

## Troubleshooting

### "WhatsApp integration not configured"
- Make sure `.env.local` exists in the project root
- Check that `META_WHATSAPP_APP_ID` is set correctly
- Restart your dev server after adding environment variables

### "Invalid redirect URI"
- Make sure you added the exact redirect URI in Meta App settings
- The URI must match exactly: `http://localhost:3000/api/whatsapp/callback`

### "No Meta Business accounts found"
- You need a Meta Business Account to use WhatsApp Business API
- Create one at https://business.facebook.com/
- Link your Facebook account to the Business Account

### "No WhatsApp phone numbers found"
- You need to set up a WhatsApp Business phone number in Meta
- Go to WhatsApp Manager: https://business.facebook.com/wa/manage/home/
- Add a phone number (this may require verification)

## Important Notes

- For development, Meta may have restrictions on sending messages
- You'll need a verified Meta Business Account for production use
- WhatsApp Business API has rate limits and may require approval for messaging













