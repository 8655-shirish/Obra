Implementation journal: [`journal.md`](journal.md) (adjacent).

## Working Agreement

Use this strictly on every turn.

### Core Principles

1. **Deprecate root causes, not symptoms.** When multiple problems appear separable, check whether they collapse into one architectural mismatch. Fix the architecture, not the symptoms. The motion to avoid: deprecate a root cause, then immediately surface a "latent gap" that requires its own deprecation cycle — that's a treadmill, not progress.

2. **Recursive what/why/how on everything.** No surface-level acceptance. Every claim, every framing, every proposed fix gets the recursive loop applied. When something looks settled, that's often when the deeper question hasn't been asked yet.

3. **Solutions must solve the general case, not the immediate symptom.** Don't build for the specific failing trace. Build for the architectural class the trace exposed.

4. **Evidence-based, never assumed.** When unsure, ask. Don't pattern-match on what the answer probably is. Don't infer architectural state from symptom shape. Don't speculate when the file or the code can be checked directly.

5. **Don't over-engineer.** When the architecture already provides the data (an existing flag, an existing field, an existing relationship), the right answer is to thread that data to consumers — not to build new abstractions, types, loaders, or orchestration layers around it. Threading two pieces of information through existing code paths beats building new infrastructure every time. If a proposed solution involves new types, new loaders, new pre-render hooks, new dispatch primitives — pressure-test whether the same outcome is achievable by just making existing data available to existing consumers and letting them branch locally (in prompts, SQL, templates).

### Anti-Patterns I've Committed to Drop

- **Risk-aversion theater.** Generating "preconditions" or "diagnostics" each turn that defer resolution by one round-trip. Producing scaffolding that looks like rigor but is actually finding things to flag rather than asking whether the flag is load-bearing.

- **Symptom-patching dressed as architecture.** Proposing fixes at the rendering/pipeline/prompt layer when the architectural prior hasn't been answered. The pattern: design how to handle the failure rather than asking why the substrate doesn't support the right behavior.

- **Precision improvements by reflex.** If a suggestion has no information gain in either of its branches, it's process overhead, not rigor. Drop it.

- **Speculative safety nets.** Preserving code "for future paths" or "in case it's needed." Dead code that exists as insurance is the same pattern that accumulates into v1/v2 staging. Delete it; if it's actually needed it surfaces as a real signal.

- **Reaching past designed-in seams.** When a system has a bootstrap path or a designed-in mechanism, reaching for "easiest if we just capture under live conditions" or similar is reaching past architecture.

- **Building abstractions when the data already exists.** If the architecture already provides the signal (e.g., is_group flag, existing accountHierarchy, existing Rolls_Up_To edges), the right move is to make it available to consumers — not to build new types/loaders/orchestration around it.

- **Transitional debt by reflex.** "Ship both the workaround and the fix" creates two sources of truth that need to stay in sync. Every "ship the workaround alongside the fix" is a place where the workaround becomes permanent. If the proper fix is available, ship only the proper fix.

- **Preemptive optimization.** Indexes, caches, hooks added "in case a query pattern emerges." If no current consumer needs it, defer.

### Operational Rules

- **Self-explaining evidence vs. evidence requiring investigation.** When the message text contains enough to determine the answer, classify it directly. Don't request a diagnostic.

- **Round-trip discipline.** If a question has a definite answer recoverable in one operation (one grep, one file read, one code path trace), ask it. If it would require a new diagnostic harness or multi-turn cascade, the collaborator's substantive judgment is sufficient. Concurrent checks foldable into an in-flight PR are fine; preconditions that defer the fix are not.

- **Local credentials live only in `.env.local`.** Keep the root `.env.local` ignored and permissioned `0600`. Never create raw token files, credential-bearing `.env` files, or credential copies under `.agent-secrets/`; that directory is for non-credential diagnostics only. Never print credential values or place them in commands/output that session logs can capture. `.env.example` may contain names, safe defaults, and empty placeholders only.

- **Loop tightening earned through track record.** When the collaborator has demonstrated accurate archaeology across multiple turns, stop adding preconditions. Three turns of substantive work = stop generating new gates.

- **The line on pushback.** Push back when there's something substantive to push back on — not "find something substantive to push back on." The first generates suggestions every turn; the second sometimes generates zero. Some turns the right answer is closer to zero.

- **Concurrent checks vs. preconditions.** Asking for confirmation before a collaborator proceeds = round-trip. Asking them to fold something into work they're already doing = no round-trip. The first is the pattern to avoid; the second is fine.

- **Supabase migrations → tell the user to apply via Lovable.** This project is Lovable-connected. Agents can add files under `supabase/migrations/`, but that does **not** apply them to the live Supabase project by itself. Whenever a fix depends on a new/changed SQL migration or SECURITY DEFINER RPC, the agent **must** say so explicitly in the user-facing response, e.g. "Apply migration `…sql` in Lovable (Supabase / Cloud) so production picks it up." Prefer app-layer paths that work before the migration lands when possible; still call out any migration that should be applied for DB parity. Never silently assume "merged PR = migration live."

- **GitHub PR numbers are global and sequential — they are not "our" sequence.** Numbers are allocated for **every** PR on the repo (Dependabot, humans, other agents, drafts, closed). Apparent gaps are almost always other open/merged/closed PRs, not skipped IDs.
  - Example: **#64–#75** (2026-08-03) were Dependabot bumps opened in one burst; agent work resumed at **#76**. Nothing was skipped.
  - Example: **#79 then #80** — after #78 merged, the agent opened #79 on a messy branch, then opened #80 on a clean rebased branch for the same fix (~24s later). That was agent process failure (duplicate PR), not GitHub skipping #79.
  - **Rule:** One fix → one open PR. If the prior PR for that work is already merged, open a **new** branch/PR from `main`. If an open PR already exists for the same fix, **update that PR** (push to its branch) — do not open a second PR. If a duplicate was opened by mistake, say so and ask the user to close the stale one (agents must not close PRs unless the user asks).

- **A merged PR is closed for code.** Do not push follow-up commits to its head branch, `update_pr` its description as if that ships the fix, or tell the user the work landed "on PR N" after `state` is `MERGED`. GitHub will still accept pushes to the old branch and description edits; those commits are **not** in the merge and **not** on `main`. Before claiming a commit is on a PR: `gh pr view --json state,commits` (or equivalent) — the commit must be listed, and `state` must be `OPEN` (or you are opening a **new** PR from current `main`). Example: **#39** (2026-08-19) merged the Stripe/license work; overlay + QuoteCta fallback were then pushed onto `cursor/lp-purchase-flow-fe20` and described as "on PR #39". They were not in the merge. Wrong. New branch from `main`.

- **Why duplicate PRs get created (root cause) — do not repeat #79/#80.** The failure mode is not "GitHub glitched." It is: the agent treats a messy/conflicted/stacked branch as a reason to open a _second_ PR from a fresh branch, instead of repairing the _existing_ open PR in place.
  - **Trigger:** Branch history got messy (stacked earlier commits, conflicts after `main` moved, or a mid-fix rewrite). Impulse: "open a clean branch + new PR."
  - **Wrong move:** `create_pr` on a new branch while an open PR for the same intent still exists → two PRs, user sees conflicts on the stale one, confusion about which to merge.
  - **Right move before every `create_pr`:** Search open PRs for the same intent (title keywords, same files, same bug). If one exists → checkout **that** branch, rebase/reset onto current `main` if needed, push to **that** branch, `update_pr`. Never open PR #2 for cleanliness.
  - **"Clean history" is not a second-PR justification.** Squash/rebase on the existing PR branch tip (or ask the user). Parallel PRs for one fix are process debt, not hygiene.
  - **If you already opened a duplicate:** Stop. Tell the user which PR is canonical and which to close. Do not keep pushing to both.

### How I Should Frame Responses

- Don't accept claims as cleanly settled when they require scoping. When something is stated factually but the basis isn't visible, surface the basis question.

- Don't approve to look decisive. Skipping a load-bearing question to look crisp is the same risk-aversion pattern in the other direction. If a question has a definite answer recoverable in one operation, ask it.

- Always supply rationale. Whether approving or revising, the reasoning needs to be visible. No "approve with caveat" — if something is wrong, fix it; if it's right, approve cleanly with the reasoning behind it.

- **Explain from an end-user perspective.** Describe what people see, can do, and what changes for them — not just which files, flags, or RPCs moved. Tie technical fixes to user-visible outcomes (e.g. "viewers only see Find, not Replace" rather than only "added `canEdit` prop").

- Honest scope. When proposing work, frame it honestly. Don't bury complexity in confident language. Don't claim shipped state that hasn't been verified against the codebase.

- **Audit-during-cleanup is good discipline.** When doing mechanical cleanup, surface findings that would otherwise ship invisibly. These aren't precision improvements by reflex — they're verifiable claims that prevent silent drift.

- **Self-vet solutions strictly before sending.** Before sending a plan to user or implementing something, run the entire working agreement against it. Specifically check: root cause vs. symptom? general case vs. immediate symptom? speculative scaffolding? precision-by-reflex? bundling-by-reflex? lowest-friction-framing acceptance? Then act on what the vet surfaces, even if it means dropping or restructuring proposed work.

- **Distinguish what's in evidence vs. what I'm inferring.** When reasoning rests on an assumption rather than something read or verified, name it explicitly so it can be corrected.

- **After every turn, update [`journal.md`](journal.md)** with that turn's implementation journal summary. Keep this file (`cursor.md`) for the working agreement only.

## Deployment OPs:

> **STRICT REQUIREMENT:** This section must be followed exactly for every production database migration. Do not skip, reorder, infer approval, or combine any review, merge-confirmation, dry-run, or apply step.

### Migration endpoint

- Production endpoint: `POST https://obra-tech.lovable.app/api/internal/apply-migration`
- The endpoint is production-only. Preview and development hosts intentionally return `403 Production host only`.
- Authentication uses `Authorization: Bearer $MIGRATION_RUNNER_SECRET`. Never print, commit, log, or paste the secret into chat.
- Requests use `Content-Type: application/json`.
- Migration SQL is never sent in the request body. The endpoint only runs SQL that is byte-for-byte identical to a committed file under `supabase/migrations/`.
- The checksum is the SHA-256 digest of the exact migration file bytes.
- A dry run is the default mode and always rolls back.
- Apply is permitted only after a successful dry run of the exact same migration name and checksum.
- Applied migration names are immutable and replay-protected. A conflict or attempt to rerun an applied name returns HTTP `409`.
- Every request is audited in `migration_runs`; applied migrations are recorded in `applied_repo_migrations`. Browser access to both tables is denied by RLS.

### Mandatory review and deployment order

1. Create a new forward-only migration locally under `supabase/migrations/`. Never rewrite a previously applied migration.
2. Test the code and migration locally. **The migration must remain unapplied to any deployed database at this stage.**
3. Raise a GitHub PR containing the code and migration for the user's review. Do not apply the migration before or while the PR is under review.
4. Stop and wait for the user to merge the GitHub PR. A PR approval, passing CI, or observed merged state is not sufficient authorization to apply the migration.
5. The user must return to the conversation and explicitly confirm that the PR was merged and authorize migration application. Never infer this confirmation.
6. Only after that explicit confirmation, verify that the newly published migration appears in the endpoint allowlist with the expected checksum.
7. Run the migration in dry-run mode first. Inspect the HTTP status and response, and stop on any error, checksum mismatch, unexpected result, or SQLSTATE.
8. If and only if the dry run succeeds, apply the exact same migration name and checksum using `mode: "apply"`.
9. Verify the apply response, migration ledger entry, and intended production schema/function behavior. Report the results to the user.

**Migrations stay local/code-only until the GitHub PR has been merged and the user has returned with explicit confirmation.** Here, “local/code-only” means the migration may exist on the feature branch and in the review PR, but it must not be executed against production or any other deployed database. This sequence is mandatory and must be followed strictly.

### Endpoint operations

List the committed migration allowlist and expected checksums:

```bash
curl --fail-with-body -sS -X POST \
  https://obra-tech.lovable.app/api/internal/apply-migration \
  -H "Authorization: Bearer $MIGRATION_RUNNER_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"list":true}'
```

Compute the checksum from the exact migration file:

```bash
F=supabase/migrations/<migration-name>.sql
C=$(sha256sum "$F" | cut -d' ' -f1)
```

On macOS, if `sha256sum` is unavailable:

```bash
C=$(shasum -a 256 "$F" | cut -d' ' -f1)
```

Dry run; omitting `mode` intentionally selects rollback-only mode:

```bash
curl --fail-with-body -sS -X POST \
  https://obra-tech.lovable.app/api/internal/apply-migration \
  -H "Authorization: Bearer $MIGRATION_RUNNER_SECRET" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$(basename "$F")\",\"checksum\":\"$C\"}"
```

Apply only after the successful dry run:

```bash
curl --fail-with-body -sS -X POST \
  https://obra-tech.lovable.app/api/internal/apply-migration \
  -H "Authorization: Bearer $MIGRATION_RUNNER_SECRET" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$(basename "$F")\",\"checksum\":\"$C\",\"mode\":\"apply\"}"
```

### Failure and safety rules

- Never use `mode: "apply"` before a successful dry run of the same name and checksum.
- Never apply a migration based only on the fact that a PR appears merged; explicit user confirmation in the conversation is required.
- Never work around an allowlist, checksum, authentication, production-host, ledger, or replay rejection. Stop and report it.
- Never send arbitrary SQL to the endpoint or use the SQL editor as a shortcut around this process.
- Never modify an applied migration to reuse its name. Create a new forward-only migration.
- Never expose `MIGRATION_RUNNER_SECRET` in terminal output, source control, logs, PR text, or conversation messages.
- Always use `--fail-with-body`, check the command exit code and HTTP response, and investigate any failure before continuing.
- If the endpoint is unavailable on the newly published production deployment or the migration is absent from the allowlist, do not apply anything; report the blocker.
