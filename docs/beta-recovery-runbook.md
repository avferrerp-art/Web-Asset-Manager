# Beta revert and recovery runbook

## Proposed beta objectives and ownership

These values are proposals until the product/data owner approves them:

- **RPO:** 24 hours for database loss.
- **RTO:** 4 hours to make a safe service available, with non-critical polling
  allowed to remain disabled during recovery.
- **Recovery owner:** named product/data owner.
- **Technical executor:** named operator with Publishing/database access.
- **Release decision owner:** named person authorized to revert application
  code or approve a data recovery.

Proposed retention:

- daily database recovery artifact/snapshot: 14 days;
- weekly recovery artifact/snapshot: 8 weeks;
- monthly recovery artifact/snapshot: 3 months;
- release SHA, release-gate output, schema-diff decision, and incident timeline:
  12 months.

The owner must verify that the platform or an approved backup destination
actually provides this schedule and review storage/privacy cost before adoption.
This repository does not configure backup retention.

## Application revert (schema and data remain valid)

1. Stop release activity and record detection time, symptoms, affected users,
   current release SHA, and last known-good SHA.
2. Disable or pause side-effecting integrations through their approved operator
   controls if continued writes could worsen impact.
3. Decide whether the last known-good application is backward-compatible with
   the current production schema. Never run hand-written production DDL.
4. Run `pnpm install --frozen-lockfile` and `pnpm run release:check` against the
   exact revert candidate.
5. The release owner publishes the approved candidate through Publish and
   reviews its schema diff. Do not use overwrite-data for an application-only
   revert.
6. Verify health, schema-verification startup, and a read-only critical journey.
7. Re-enable integrations only after the owner confirms data consistency.

If an old binary cannot operate on the current schema, prefer a forward fix.
Production schema changes must flow from the development schema through Publish,
including explicit rename/destructive-change confirmation.

## Data recovery

1. Declare the incident and prevent avoidable new writes. Preserve logs and the
   incident timeline.
2. Identify the recovery point from the approved recovery inventory; compare it
   with the proposed RPO. Do not describe a snapshot as restorable without a
   successful isolated rehearsal.
3. Restore into an **isolated destination**, never over the live database for
   the first attempt.
4. Validate schema, row counts for agreed critical tables, referential/business
   invariants, timestamps, and a read-only application smoke test. Record exact
   commands, artifact identifier, duration, and results without secret values.
5. Have the data owner approve the recovery point and expected loss window.
6. Use the platform's approved promotion/cutover procedure. Keep the prior
   production state protected until sign-off.
7. Verify critical journeys, integrations, and reconciliation before resuming
   normal writes. Record actual RPO/RTO achieved.

## Rehearsal status and owner action

`bash scripts/beta-synthetic-restore-rehearsal.sh` is safe to run locally. It
creates an ephemeral PostgreSQL cluster, inserts synthetic rows, performs a
custom-format dump/restore into a second local database, verifies a deterministic
count/hash, and removes the cluster. It never reads `DATABASE_URL`.

That synthetic exercise validates only local PostgreSQL tooling and procedure;
it is **not evidence that production backups exist or can be restored**. No
isolated managed restore destination is configured, so a rehearsal using a real
approved recovery artifact cannot be performed safely yet.

The release gate's separate ephemeral PostgreSQL harness also proves that the
current Drizzle schema can bootstrap a blank local database and support the
selected critical integration tests. It does not consume or validate any
production backup and does not change the real-restore status above.

Owner action:

1. approve RPO, RTO, retention, privacy, and budget;
2. configure or designate an isolated, access-controlled restore destination;
3. identify the platform-supported production recovery artifact without
   exposing credentials;
4. authorize an operator to restore there and execute the validation checklist;
5. retain dated evidence and schedule at least quarterly rehearsals.