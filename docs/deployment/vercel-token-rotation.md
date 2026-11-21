# Vercel token rotation for production releases

The production release workflow authenticates with the repository secret
`VERCEL_TOKEN`. The token must belong to a real Vercel user with access to the
production team; team-scoped API reads can still succeed with a token the CLI
rejects, so the release workflow now fails closed before building.

Production identity is pinned in `scripts/lib/productionReleaseGuards.cjs`:

- Team: `collins-projects-f49524b8` / `team_oWPGv9x9bpRD2nRmUM2lKpzJ`
- Project: `finza-app` / `prj_BxbfIgXTl1PAX6W3635Nsc8KXuW1`
- Region: `arn1`
- Domain: `app.finza.africa`

`VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` repository secrets are no longer used.
Do not add them back; stale values previously broke `vercel link`.

## Create the replacement token

1. Sign in to Vercel as the owner of the production team.
2. Open **Account Settings → Tokens**.
3. Create a token scoped to the production team (`collins-projects-f49524b8`).
4. Give it a descriptive name, for example `github-actions-production`.
5. Set an expiry that matches your rotation policy.
6. Copy the token once. It cannot be viewed again.

## Store it in GitHub Actions

1. Open the repository on GitHub.
2. Go to **Settings → Secrets and variables → Actions**.
3. Update the existing repository secret `VERCEL_TOKEN`, or add it to the
   protected `production` environment if the release job uses one.
4. Never commit the token, paste it into a PR, or write it to a log.

## Revoke the old token

After the replacement is stored and validated, revoke the old token in Vercel
so it cannot be reused.

## Validate without deploying

Run the **Vercel authentication check** workflow manually
(`Actions → Vercel authentication check → Run workflow`). It only calls
`vercel whoami` and reads the production project; it never deploys.

Expected output:

```text
Vercel authentication OK: user=<account> project=finza-app team=team_oWPGv9x9bpRD2nRmUM2lKpzJ
```

The production release workflow also runs this check before the build, so an
invalid token fails in seconds instead of after a full build.

## Then release

Run **Production release** with `confirm=RELEASE` after the auth check passes.
The release script still enforces SHA, ARN1, alias, cron, Supabase identity and
clean-worktree guards.
