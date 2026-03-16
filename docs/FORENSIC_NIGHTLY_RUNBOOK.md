# Forensic Accounting Nightly Runbook

Minimal runbook for the nightly forensic accounting verification job: scheduler, secrets, and how to verify runs.

## Overview

- **Endpoint:** `POST /api/cron/forensic-accounting-verification`
- **Auth:** `Authorization: Bearer <CRON_SECRET>`
- **Schedule:** 02:00 UTC nightly (GitHub Actions) + optional manual trigger

---

## 1. Hosting environment

Set the following in your hosting env (Vercel, Railway, etc.):

| Variable           | Description |
|--------------------|-------------|
| `CRON_SECRET`      | Shared secret used to authorize cron requests. Generate a long random value (e.g. `openssl rand -hex 32`). |

- If `CRON_SECRET` is missing, the endpoint returns **401** and does not run the job.

### Optional: Slack + Email escalation

Alerts fire only when there are **open** failures with **severity = 'alert'**, and only if escalation is enabled:

| Variable | Description |
|----------|-------------|
| `FORENSIC_ALERT_ENABLED` | Set to `true` to enable Slack/Email alerts. Omit or any other value = no alerts. |
| `FORENSIC_ALERT_SLACK_WEBHOOK` | Slack incoming webhook URL. If set, a message is sent when alertable open failures exist. |
| `FORENSIC_ALERT_EMAIL` | Email address to receive alerts. Used with Resend (see below). |
| `RESEND_API_KEY` | (For email) Resend API key. If set with `FORENSIC_ALERT_EMAIL`, alert emails are sent via Resend. |
| `RESEND_FROM` | (Optional) From address for Resend, e.g. `Finza Alerts <alerts@yourdomain.com>`. |
| `ADMIN_URL` or `NEXT_PUBLIC_APP_URL` | Base URL for dashboard links in alerts (e.g. `https://app.example.com`). |

- Each run is alerted at most once (`alert_sent` flag). Run detail page shows **Alert sent: YES / NO**.
- Alert failures are logged but do not change the cron response (still 200).

---

## 2. GitHub repository secrets

For the workflow [`.github/workflows/forensic-nightly.yml`](../.github/workflows/forensic-nightly.yml), configure:

| Secret                  | Description |
|-------------------------|-------------|
| `FORENSIC_CRON_URL`     | Full URL of the cron endpoint, e.g. `https://<your-domain>/api/cron/forensic-accounting-verification` |
| `FORENSIC_CRON_SECRET`  | Same value as `CRON_SECRET` in your hosting environment |

**Setting secrets:** Repo → Settings → Secrets and variables → Actions → New repository secret.

---

## 3. Manual test (curl)

From any machine with the secret:

```bash
curl -X POST "https://<your-domain>/api/cron/forensic-accounting-verification" \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  -H "Content-Type: application/json"
```

- **200:** Response body is JSON with `run_id` and `summary` (e.g. `total_failures`, `alertable_failures`, `check_counts`).
- **401:** Missing or invalid `Authorization: Bearer` header, or wrong/empty `CRON_SECRET` in env. Body: `{ "error": "unauthorized" }`.

---

## 4. Viewing the latest run in the UI

1. Open the app as a user with access (Owner, Firm Admin, or Accounting Admin).
2. Go to **Accounting → Forensic Runs** (sidebar under ACCOUNTING (Advanced), or direct link: `/admin/accounting/forensic-runs`).
3. The most recent run is at the top. Click a row to open run detail and failures.

The **Accounting health** widget on the main accounting page shows last run status, time, and failure count.

---

## 5. Troubleshooting

| Symptom | Check |
|--------|--------|
| 401 from cron | `CRON_SECRET` set in hosting; request uses `Authorization: Bearer <CRON_SECRET>`; no typo in URL or secret. |
| Workflow fails | GitHub secrets `FORENSIC_CRON_URL` and `FORENSIC_CRON_SECRET` set; URL is the **deployed** app URL, not localhost. |
| No new runs | Confirm the workflow ran (Actions tab); confirm the deployed app is the same one that has `CRON_SECRET` and Supabase env. |
