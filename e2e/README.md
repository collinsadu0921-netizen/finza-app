# Playwright — service workspace

Smoke tests for `/service/*` UI and a few `/api/service/*` routes.

## Setup

1. Copy credentials into `.env.local` (never commit):

   - `E2E_SERVICE_EMAIL` / `E2E_SERVICE_PASSWORD` — Supabase user that can open the **service** workspace (business `industry = service`).
   - Optional `E2E_SERVICE_BUSINESS_NAME` — substring of the trading name if the user lands on `/select-workspace` and you need a specific card.
   - Optional `E2E_SERVICE_BUSINESS_ID` — skips scraping `business_id` from the dashboard for the expenses activity API test.
   - Optional `PLAYWRIGHT_BASE_URL` — defaults to `NEXT_PUBLIC_APP_URL` or `http://127.0.0.1:3000`.

2. Install browser binaries once: `npm run test:e2e:install`

3. Run: `npm run test:e2e` — with credentials set, Playwright starts `npm run dev` automatically (or reuses an already-running app on `PLAYWRIGHT_BASE_URL` when not in CI).

Without `E2E_SERVICE_EMAIL` / `E2E_SERVICE_PASSWORD`, all specs are **skipped** and no dev server is started.
