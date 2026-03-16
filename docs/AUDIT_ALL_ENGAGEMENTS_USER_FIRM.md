# AUDIT — ALL Engagements Across System (User and Firm)

**Goal:** Audit ALL engagements for this user and firm. Return ALL matches.

---

## Query 1 — All engagements (with client business name)

```sql
SELECT
  fce.id,
  fce.accounting_firm_id,
  fce.client_business_id,
  b.name AS client_business_name,
  fce.status,
  fce.created_at
FROM firm_client_engagements fce
LEFT JOIN businesses b
  ON b.id = fce.client_business_id
ORDER BY fce.created_at DESC;
```

**Return ALL matches.**

---

## Query 2 — User ↔ firm

```sql
SELECT
  afu.user_id,
  afu.firm_id,
  af.name AS firm_name
FROM accounting_firm_users afu
LEFT JOIN accounting_firms af
  ON af.id = afu.firm_id;
```

**Return ALL matches.**

---

## Query 3 — All businesses (id, name, owner)

```sql
SELECT
  id,
  name,
  owner_id
FROM businesses
ORDER BY created_at DESC;
```

**Return ALL matches.**
