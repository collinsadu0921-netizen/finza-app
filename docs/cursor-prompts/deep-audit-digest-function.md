# Cursor Prompt — Deep Audit

We are still getting:

```
function digest(text, unknown) does not exist
```

Even though:

* `pgcrypto` is installed
* It is installed in schema `extensions`
* The function header was updated to:

```sql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog;
```

Audit the following:

---

## 1️⃣ Verify actual deployed function

Run:

```sql
SELECT pg_get_functiondef(p.oid)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'post_manual_journal_draft_to_ledger';
```

Confirm:

* The deployed function includes `SET search_path = public, extensions, pg_catalog`
* There is not another overloaded version of the function

---

## 2️⃣ Verify digest visibility inside function context

Run:

```sql
SHOW search_path;
```

Then test manually:

```sql
SELECT digest('test', 'sha256');
```

If that fails, test:

```sql
SELECT extensions.digest('test', 'sha256');
```

If the second works but first fails, the function must explicitly use:

```sql
extensions.digest(...)
```

---

## 3️⃣ Check for multiple function versions

Run:

```sql
SELECT proname, proargtypes
FROM pg_proc
WHERE proname = 'post_manual_journal_draft_to_ledger';
```

Ensure there is only ONE version.

---

## 4️⃣ If search_path is correct but digest still fails

Modify the function to explicitly call:

```sql
extensions.digest(...)
```

instead of:

```sql
digest(...)
```

This removes dependency on search_path entirely.

---

## Return

* Current deployed function header
* search_path result
* Whether `SELECT digest('test','sha256')` works
* Whether `SELECT extensions.digest('test','sha256')` works
* Count of function versions

**No fixes yet. Audit only.**
