# Fix template personalization admission

## Changes
- Add a forward-only database migration that admits `personalize_template` as a valid agent intent.
- Require personalization claims to carry the selected website version ID and its server-resolved revision, preserving the existing stale-version fence.
- Update the agent claim input so both regeneration and personalization send their source version snapshot.
- Add a regression check covering the new intent and snapshot requirement.

## Validation
- Apply the migration to Lovable Cloud.
- Run the focused agent ownership and authentication checks.
- Retry personalization and confirm the request advances past claim creation into the AI/tool flow.

## Technical detail
The HTTP endpoint already validates the version belongs to the selected website and resolves its revision server-side. The fix extends `claim_agent_turn` without weakening ownership, idempotency, or revision checks.
