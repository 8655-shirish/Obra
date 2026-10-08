# Verification and release gates

These gates deliberately separate repository/source confidence from release evidence.

## Required checks

| Check                               | Trigger                        | What it proves                                                                                                                 | What it does not prove                                                               |
| ----------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `Verification / source-contract`    | pull request and `main` push   | locked install, nonincremental TypeScript, production build, Bucket 3 booking contracts, and the Bucket 1 generation aggregate | a browser ran, a migrated database behavior suite ran, or production is ready        |
| `Release proof / source-contract`   | release tag or manual dispatch | the same install, typecheck, build, booking contracts, and generation aggregate passed for the released revision               | database or deployed-browser behavior                                                |
| `Release proof / database-behavior` | release tag or manual dispatch | every repository migration version is recorded on the target, then the transactional Bucket 1 SQL behavior suite passes        | production data safety or migration rehearsal                                        |
| `Release proof / browser-proof`     | release tag or manual dispatch | pinned Chromium is installed and the runtime validation actually completes; a durable external evidence reference was supplied | that CI itself reproduced the deployed closed-browser smoke referenced by the secret |

Configure the first check as a required branch check. Configure all three Release proof jobs as required release/tag checks in the repository ruleset; workflow files cannot create that GitHub ruleset themselves.

## Required release secrets

- `RELEASE_DATABASE_URL`: an isolated, fully migrated Supabase-compatible PostgreSQL target. The job fails before testing when absent. The SQL behavior suite runs in a rollback transaction.
- `RELEASE_BROWSER_EVIDENCE`: a durable, reviewed reference (artifact/run/incident URL or ID) to the deployed closed-browser release evidence required by `docs/runbooks/bucket1-generation.md`. The job fails when absent and also fails unless its own pinned Chromium validation executes.

Do not put secret values in artifacts or logs. The browser evidence reference is an attestation input, not a substitute for reviewing the deployed proof.

## No browser false green

`pnpm test:bucket1-generation` is a **source-contract** aggregate. Its runtime verifier intentionally checks that browser absence becomes `infrastructure_failed`, but that verifier can still exit successfully after validating this failure contract. Therefore it is never labeled browser or production success.

Only `scripts/verify-release-browser-proof.mjs` is the CI browser proof gate. It rejects the browser-unavailable success message and requires the installed-Chromium completion marker.

## Local reproduction

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit --incremental false --pretty false
pnpm run build
pnpm verify:bucket3
pnpm test:bucket1-generation

DATABASE_URL='postgresql://…' bash scripts/verify-release-database.sh
RELEASE_BROWSER_EVIDENCE='artifact-or-run-reference' node scripts/verify-release-browser-proof.mjs
```

The final command requires the pinned Playwright Chromium binary to have been installed. A missing browser is a release-gate failure, not runtime success.
