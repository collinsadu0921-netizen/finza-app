# Finza Hubtel Status Proxy (UpCloud VPS)

Static-IP proxy so Finza on Vercel can call Hubtel's Transaction Status Check API. Hubtel requires server IP whitelisting; Vercel outbound IPs are not static.

**Flow:** Vercel → `POST /hubtel/status-check` (this service) → Hubtel `api-txnstatus.hubtel.com`

## Prerequisites

- UpCloud VPS with a **static public IPv4** whitelisted by Hubtel
- Node.js 20+
- Same shared secret on Vercel and this server

## Quick deploy (UAT — HTTP + secret header)

> Add HTTPS (Nginx + Let's Encrypt) before relying on this in production.

### 1. Copy files to the VPS

```bash
scp -r services/hubtel-status-proxy root@YOUR_UPCLOUD_IP:/opt/finza-hubtel-status-proxy
```

Or clone the repo and `cd services/hubtel-status-proxy`.

### 2. Install Node.js 20 (Ubuntu/Debian example)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # should be v20+
```

### 3. Configure environment

```bash
cd /opt/finza-hubtel-status-proxy
cp .env.example .env
nano .env
```

Set:

```env
HUBTEL_STATUS_PROXY_SECRET=<same long random secret as Vercel>
PORT=3100
```

Generate a secret:

```bash
openssl rand -hex 32
```

### 4. Build and run with PM2

```bash
npm ci
npm run build
sudo npm install -g pm2
pm2 start dist/index.js --name finza-hubtel-status-proxy
pm2 save
pm2 startup   # follow printed command to enable on boot
```

### 5. Firewall

Allow SSH and the proxy port only from trusted sources if possible. For UAT, open the proxy port to Vercel (or `0.0.0.0/0` temporarily with a strong secret):

```bash
sudo ufw allow OpenSSH
sudo ufw allow 3100/tcp
sudo ufw enable
sudo ufw status
```

**Later:** put Nginx in front with TLS, expose `443` only, and restrict `3100` to localhost.

### 6. Health check

```bash
curl -s http://127.0.0.1:3100/health
# {"ok":true,"service":"finza-hubtel-status-proxy"}
```

### 7. Vercel environment variables

In the Finza Vercel project:

| Variable | Example |
|----------|---------|
| `HUBTEL_STATUS_PROXY_URL` | `http://YOUR_UPCLOUD_PUBLIC_IP:3100/hubtel/status-check` |
| `HUBTEL_STATUS_PROXY_SECRET` | same value as on the VPS |

Redeploy Vercel after setting these.

## systemd alternative (no PM2)

Create `/etc/systemd/system/finza-hubtel-status-proxy.service`:

```ini
[Unit]
Description=Finza Hubtel Status Proxy
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/finza-hubtel-status-proxy
EnvironmentFile=/opt/finza-hubtel-status-proxy/.env
ExecStart=/usr/bin/node /opt/finza-hubtel-status-proxy/dist/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now finza-hubtel-status-proxy
sudo systemctl status finza-hubtel-status-proxy
```

## Nginx + HTTPS (recommended before production)

1. Point a subdomain (e.g. `hubtel-proxy.yourdomain.com`) at the VPS IP.
2. Install Nginx and Certbot.
3. Proxy `https://hubtel-proxy.yourdomain.com/hubtel/status-check` → `http://127.0.0.1:3100/hubtel/status-check`.
4. Set Vercel `HUBTEL_STATUS_PROXY_URL` to the HTTPS URL.

## Local test against the proxy

```bash
# Terminal 1 — proxy
cd services/hubtel-status-proxy
export HUBTEL_STATUS_PROXY_SECRET=test-secret
npm run build && npm start

# Terminal 2 — missing secret → 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:3100/hubtel/status-check \
  -H "Content-Type: application/json" \
  -d '{"apiId":"x","apiKey":"y","merchantAccountNumber":"2038909","clientReference":"FZHBTEST"}'

# Terminal 2 — valid secret (returns Hubtel status/body)
curl -s -X POST http://127.0.0.1:3100/hubtel/status-check \
  -H "Content-Type: application/json" \
  -H "x-finza-internal-secret: test-secret" \
  -d '{"apiId":"YOUR_API_ID","apiKey":"YOUR_API_KEY","merchantAccountNumber":"2038909","clientReference":"FZHB6A279H1MWBR5C61YP3S8DG3D3OYS"}'
```

## Retest the failed Finza transaction

After Vercel env vars are set and Hubtel has whitelisted the UpCloud IP:

1. Open the public invoice pay page for invoice `eb2c573e-d9ba-4c5f-a614-bcf77e27aed1` (with its public token), or call the status API directly:

```bash
curl -s "https://YOUR_FINZA_DOMAIN/api/payments/hubtel/tenant/invoice/status?clientReference=FZHB6A279H1MWBR5C61YP3S8DG3D3OYS&invoice_id=eb2c573e-d9ba-4c5f-a614-bcf77e27aed1&token=INVOICE_PUBLIC_TOKEN"
```

2. Check UpCloud proxy logs: `pm2 logs finza-hubtel-status-proxy`
3. Confirm `payment_provider_transactions` / events updated in Supabase for checkout `0a4441c84ea34bd19634ad0e3e222e9e`.

## API

### `GET /health`

Returns `{ "ok": true, "service": "finza-hubtel-status-proxy" }`.

### `POST /hubtel/status-check`

**Headers:** `x-finza-internal-secret: <secret>`

**Body (JSON):**

| Field | Required | Notes |
|-------|----------|-------|
| `apiId` | yes | Hubtel API ID |
| `apiKey` | yes | Hubtel API key |
| `merchantAccountNumber` | yes | POS / merchant account |
| `clientReference` | yes | Finza reference (e.g. `FZHB…`) |
| `checkoutId` | no | Logged only |
| `paymentProviderTransactionId` | no | Logged only |
| `invoiceId` | no | Logged only |
| `workspace` | no | Logged only |

**Response:** Raw Hubtel HTTP status and JSON body (pass-through).

**Errors:** `401` bad/missing secret, `400` validation, `502` Hubtel/network failure from proxy.
