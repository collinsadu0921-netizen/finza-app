# Release 06 — Production exposure assessment (read-only)

**Assessment date:** 11 November 2026  
**Mode:** Read-only public probes and static bundle inspection. No production database access, no customer file access, no exploit attempt.

## Findings

Production at `https://app.finza.africa` exposes the proposal feature:

| Probe | Result |
|---|---|
| `GET /api/health/version` | `200` `{"commit_sha":null,"environment":"production","region":"arn1"}` |
| `GET /api/proposals/public/release06-invalid-token` | `404` JSON `{"error":"Proposal not found"}` |
| `GET /api/proposals/public/release06-invalid-token/assets/00000000-0000-4000-8000-000000000000` | `404` JSON `{"error":"Not found"}` |
| `GET /proposal-public/release06-invalid-token` | `200` HTML shell |
| `GET /service/proposals` unauthenticated | `307` to `/login?next=%2Fservice%2Fproposals` |

The production deployment `dpl_Bk68rLQzYN5osmYK68dECg3YK7vL` was created on 10 November 2026 at 14:11 CET by the Vercel CLI. Its Vercel metadata does not contain a Git commit SHA, and the production health endpoint returns `commit_sha: null`. The deployment therefore cannot be mapped to a repository commit from public metadata.

`origin/main` does not contain the Stage 01 or Stage 04 proposal commits:

- `git merge-base --is-ancestor ddfc01a origin/main` → not ancestor
- `git merge-base --is-ancestor 2a40c90 origin/main` → not ancestor

The production proposal API therefore did not come from the current `main` history. It is consistent with a deployment from a staging/proposal branch, which would include the pre-remediation asset code.

## Severity and exposure window

**Severity: high / potentially critical, pending database verification.**

The Release 05 P0 requires two conditions:

1. an authenticated tenant can update `proposal_assets.storage_path` through RLS or a privileged path; and
2. the public asset proxy resolves that path with the service role.

The production public proxy route exists. Its database policy state could not be verified without production database credentials, and no production customer data or exploit was accessed. The exposure therefore **cannot be reasonably excluded**.

The earliest confirmed production deployment containing proposal routes is the 10 November 2026 production deployment. Both currently listed production deployments were probed read-only through Vercel's authenticated `vercel curl` (without exposing customer data):

| Production deployment | Created (UTC) | Proposal public API |
|---|---|---|
| `finza-dj7yx11tj-…` (current) | 2026-11-10 13:11:43 | `404 {"error":"Proposal not found"}` |
| `finza-3zle812oa-…` (previous) | 2026-11-10 00:49:46 | `404 {"error":"Proposal not found"}` |

The confirmed production exposure window is therefore **at least from 2026-11-10 00:49 UTC** to the time of this assessment. Earlier deployments are not present in the current Vercel list; the true start may be earlier if a proposal build was promoted before that deployment.

## Evidence limitations

- No Git SHA in production deployment metadata or health response.
- No authorised production database connection; `proposal_assets` RLS, triggers, grants, and Storage policies were not read.
- No production proposal token or customer file was used.
- Client-bundle strings were not conclusive: `createSignedUploadUrl`/`uploadToSignedUrl` are expected in the bundled Supabase client library and do not prove the new upload flow is deployed.

## Recommended containment (requires authorisation)

1. **Freeze the affected surface.** Disable the public proposal asset proxy or the proposal feature in production until the database policy state is verified. This is a business decision; no change was made.
2. **Authorised read-only database audit.** Check:
   - `proposal_assets` UPDATE policy and grants;
   - whether `storage_path`, `business_id`, or `proposal_id` can be updated by `authenticated`;
   - `storage.objects` policies for `proposal-assets`;
   - rows whose `storage_path` does not start with `${business_id}/${proposal_id}/`;
   - audit/access logs for public proposal asset requests and asset updates.
3. **Preserve evidence.** Export relevant audit logs and database policy definitions before any remediation.
4. **Apply migration 702 and deploy the isolated release candidate** only after the audit and explicit approval.
5. **Assess notification obligations** with the security/incident owner if cross-tenant access is found.
6. Do not rotate keys blindly; first preserve logs and determine whether the service-role key or a tenant session was used.

No production change, migration, deployment, or customer communication was performed during this assessment.
