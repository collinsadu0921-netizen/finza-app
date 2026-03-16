# AUDIT ROOT CAUSE — Engagement Missing In Service Invitations

**Goal:** Prove whether mismatch is caused by business ownership, wrong business context, or engagement linked to wrong business.

**Return DATA ONLY. No explanation.**

---

## STEP 1 — Identify engagement

```sql
SELECT id, accounting_firm_id, client_business_id, status
FROM firm_client_engagements
WHERE accounting_firm_id IN (
  SELECT firm_id
  FROM accounting_firm_users
  WHERE user_id = '<YOUR_USER_ID>'
)
ORDER BY created_at DESC;
```

---

## STEP 2 — Inspect the business linked to engagement

```sql
SELECT id, name, owner_id
FROM businesses
WHERE id = '<CLIENT_BUSINESS_ID_FROM_STEP_1>';
```

---

## STEP 3 — List all businesses owned by user

```sql
SELECT id, name, owner_id, created_at
FROM businesses
WHERE owner_id = '<YOUR_USER_ID>'
ORDER BY created_at DESC;
```

---

## STEP 4 — Simulate service resolver

(Which business Service workspace loads)

```sql
SELECT id, name
FROM businesses
WHERE owner_id = '<YOUR_USER_ID>'
ORDER BY created_at DESC
LIMIT 1;
```

---

## STEP 5 — Compare results

**Output:**

| Field | Value |
|-------|--------|
| Engagement business ID | `<CLIENT_BUSINESS_ID_FROM_STEP_1>` |
| Service resolved business ID | `<id FROM STEP 4>` |
| Match | TRUE / FALSE |
