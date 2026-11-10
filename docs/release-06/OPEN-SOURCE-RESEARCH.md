# Release 06 — Open-source research and design decisions

**Retrieved:** 11 November 2026  
**Scope:** proposal asset authorisation, private Storage access, upload architecture, MIME safety, and PDF/cover remediation.

## Sources reviewed

### Supabase

- Storage access control — https://supabase.com/docs/guides/storage/security/access-control
- Resumable uploads (TUS, signed upload tokens, expiry, revocation) — https://supabase.com/docs/guides/storage/uploads/resumable-uploads
- Column-level security — https://supabase.com/docs/guides/database/postgres/column-level-security
- Storage helper functions — https://supabase.com/docs/guides/storage/schema/helper-functions
- URL signing keys and revocation limits — https://supabase.com/docs/guides/storage/security/signing-keys
- `createSignedUploadUrl` reference — https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl
- Supabase repository — https://github.com/supabase/supabase
- Storage engine repository — https://github.com/supabase/storage
- Storage operation names — https://raw.githubusercontent.com/supabase/storage/master/src/http/routes/operations.ts

Key findings:

- Storage RLS is enforced on `storage.objects`; a bucket with no policy denies access by default.
- The service key bypasses Storage RLS entirely. Any server path using it must independently bind the request to the authenticated tenant and object.
- A signed upload URL is valid for **2 hours** and is path-specific.
- TUS upload URLs are valid for **up to 24 hours** and support progress/resume, but add a client dependency and more moving parts.
- Signed URLs cannot be revoked individually; revocation is by rotating/revoking the Storage URL signing key, and CDN caches can outlive key revocation.
- Column-level privileges are supported, but table-level grants must be revoked first. Restricted roles must select columns explicitly; a table-level privilege overrides a column-level revoke.
- Supabase's operation-aware helpers (`storage.allow_only_operation` / `allow_any_operation`) are useful for listing vs. download, but must be applied with care: in staging testing, an operation-filtered SELECT policy blocked Storage's internal select needed by `remove()`. A path-scoped SELECT policy was required for deletion to work.

### OWASP Cheat Sheet Series

- File Upload Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
- Authorization Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- Insecure Direct Object Reference Prevention — https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html
- Multi-Tenant Security — https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html

Key findings:

- Do not trust the declared Content-Type. Validate file signatures and decode image content; re-encode where feasible.
- Generate storage filenames server-side and authorise every object access, not just the page.
- Tenant identifiers in URLs/headers are selectors, not authorisation. The server must re-check membership and object ownership.
- Object naming/prefixes are not an authorisation boundary by themselves; enforce a policy at a boundary traversed by every access path.
- Treat signed URLs as bearer capabilities with a limited lifetime and plan for revocation limits.
- Log denied cross-tenant attempts and test both allowed and denied operations.

### Vercel

- Functions limits — https://vercel.com/docs/functions/limitations
- Bypassing the 4.5 MB body-size limit — https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions

Key findings:

- Vercel Functions have a **4.5 MB** request/response body limit (streaming responses excepted).
- Large uploads should go directly from the browser to the storage provider after a server-issued token; do not proxy them through a Function.
- The old 15 MB multipart route could never work on Vercel.

### PostgreSQL

- Row Security Policies — https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- `GRANT` / column privileges — https://www.postgresql.org/docs/current/sql-grant.html

Key findings:

- RLS is default-deny once enabled and no policy applies.
- `USING` and `WITH CHECK` control which existing rows are visible and which new rows are permitted.
- Table owners, superusers and `BYPASSRLS` roles bypass RLS; the service role must be treated as privileged.
- Table-level `UPDATE` must be revoked before column-level `UPDATE` grants can restrict sensitive columns.
- Triggers can enforce invariants that RLS alone cannot express, including immutable ownership fields and path binding.

## Viable approaches compared

### Asset authorisation

| Approach | Security | Complexity | Performance | Operational cost | Compatibility | Decision |
|---|---|---|---|---|---|---|
| RLS path check only | Weak alone: service-role proxy still trusts `storage_path`; a policy mistake reopens cross-tenant reads | Low | High | Low | High | **Rejected** as the sole control — this was the Release 05 P0 |
| Server-generated immutable path + DB constraint/trigger + column privileges + RLS + route validation + Storage policies | Strong defence in depth; blocks the write, the trigger, and the read proxy independently | Medium | High (small per-row checks) | Low | High | **Selected** |
| Separate schema/bucket per tenant | Strong isolation | High | High | High; migration/routing per tenant | Low for this shared-schema product | Rejected |
| Signed URL direct retrieval only | Avoids service-role proxy | Medium | High | Medium; revocation/caching limits | Medium | Rejected as primary; can complement later |

### Upload architecture

| Approach | Security | Complexity | Performance | Cost | Compatibility | Decision |
|---|---|---|---|---|---|---|
| Multipart through a Vercel Function | App-side checks possible | Low | Poor; hard 4.5 MB limit | Low | Existing code | **Rejected** — cannot meet 15 MB |
| Server-issued signed upload URL + server finalisation/validation | Server controls path, token lifetime and final DB row; browser uploads directly to private Storage | Medium | Good; no Vercel body limit | Low | Existing Supabase Storage and `supabase-js` | **Selected** |
| TUS resumable uploads | Same as signed upload, plus retry/resume and progress | Medium-high; adds `tus-js-client`; more client/server state | Best for unreliable networks/large files | Low-medium | Requires client integration | Deferred; not required to meet 15 MB and would increase release surface |
| Vercel Blob client upload | Strong direct-upload model | Medium | Good | Additional storage provider/egress | Low; would duplicate Storage | Rejected |
| Edge Function proxy | Keeps uploads server-side | Medium | Still limited by body/stream handling | Medium | Additional runtime | Rejected |

## Selected design

1. **Path is authoritative and immutable.** The server generates `${business_id}/${proposal_id}/${asset_id}.${ext}`. `business_id`, `proposal_id` and `storage_path` cannot be changed after insert. A database trigger also verifies the proposal belongs to the business.
2. **Column privileges.** `anon` and `authenticated` lose table-level `INSERT`/`UPDATE` on `proposal_assets`; authenticated staff may update only presentation/visibility fields. Server routes use the service role after explicit tenant/proposal authorization.
3. **Signed upload + finalize.** `POST /assets/upload-intent` creates a `pending` row and a 2-hour signed upload URL. The browser uploads directly to the private bucket. `POST /assets/finalize` downloads the object with the service role, validates/re-encodes it, and only then marks it `ready`. Public readers ignore `pending` rows.
4. **Defence in depth on read.** The public asset proxy checks the public token, proposal expiry, asset proposal/business binding, ready state, public visibility, exact path prefix, and magic-byte MIME before returning the object. Images are inline; PDFs are attachments; every response has `nosniff`.
5. **Storage RLS.** The private bucket is non-public. Authenticated insert/select/delete policies are scoped to a real proposal under the authenticated business. The SELECT policy is path-scoped without operation filtering because Storage delete requires an internal select; this was verified on staging.
6. **MIME safety.** Images are decoded with `sharp`, checked against the declared format/dimension/pixel limits, stripped and re-encoded. PDFs must have a valid header/EOF and parse as at least one page. SVG and other active formats remain disallowed.
7. **Cleanup.** Pending uploads expire after two hours. The finalize endpoint rejects expired intents; a lazy cleanup runs before a new intent, and a `CRON_SECRET`-protected route removes abandoned pending rows and objects.

## Rejected alternatives and rationale

- **Do not rely on a string-prefix check only.** Release 05 proved that the database write must be constrained independently of the read route.
- **Do not use the service role as the request path.** It is used only after an explicit authorization and binding check.
- **Do not expose a broad `authenticated` Storage SELECT policy.** The policy is scoped to the exact business/proposal path and verified against a live proposal.
- **Do not add TUS now.** The selected signed-upload flow satisfies the 15 MB requirement without a new runtime dependency. TUS remains a future reliability enhancement, not a release prerequisite.
- **Do not redesign the proposal templates.** Only the decorative cover labels and PDF ligature settings are changed.

## Licence/dependency notes

- Supabase and its Storage engine are Apache-2.0; no new Supabase dependency was added.
- OWASP Cheat Sheet Series is CC BY-SA 4.0; used as guidance, no code copied.
- `sharp` and `pdf-parse` were already runtime dependencies.
- No new package was added for this remediation. `tus-js-client` (MIT) was evaluated and deferred.
- Vercel documentation is used for platform limits; no code copied.
