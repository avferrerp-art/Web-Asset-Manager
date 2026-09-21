# Beta release runbook

## Current decision and constraints

- The current production deployment was verified as healthy, public, and
  autoscale. No paid topology change has been enabled by this preparation.
- Autoscale instances may stop or be replaced. The API starts embedded polling
  and reconciliation timers after listening, so those timers are not a reliable
  production scheduler on autoscale.
- **Recommendation:** use a Reserved VM for this beta while those jobs remain
  embedded. This is a recommendation only and requires owner approval before
  changing Publishing settings. A durable external scheduler/queue would be the
  longer-term alternative.
- Production database DDL is owned by Replit Publish. API boot performs
  read-only schema verification and fails closed; it does not run migrations.
  Development boot may run embedded migrations.

## Release gate

From a clean checkout with the committed `pnpm-lock.yaml` and installed
dependencies:

```sh
pnpm install --frozen-lockfile
pnpm run release:check
```

`release:check` runs, in order:

1. the workspace TypeScript check;
2. production builds for API Server and Logistics Manager (with Logistics'
   checked-in service environment supplied explicitly);
3. deterministic health, authorization policy, critical-audit middleware, Odoo
   synchronization coordinator/busy-route, load-calculator, and fleet tests;
4. an isolated local PostgreSQL integration harness for dispatch/transfer,
   trip, arrival-act, and warehouse-access behavior.

The deterministic group runs these exact files with a deliberately unusable
`DATABASE_URL`, so an accidental database query cannot reach a shared database:

- `health.test.ts`
- `odoo-sync-status.test.ts`
- `authorization-policy.test.ts`
- `audit-middleware.test.ts`
- `odoo-synchronization-coordinator.test.ts`
- `odoo-route-busy.test.ts`
- `carga-calculadora.test.ts`
- `fleet-split.test.ts`

The integration harness unsets the caller's `DATABASE_URL`, starts PostgreSQL
with TCP disabled and only an ephemeral Unix socket, creates a blank database,
bootstraps it from the Drizzle schema source using `push-force`, and runs these
files sequentially:

- `dispatches-traslados.test.ts`
- `viajes.test.ts`
- `actas-llegada.test.ts`
- `almacen-access-api.test.ts`

It supplies `release-admin@test.invalid` as a test-only `ADMIN_EMAILS` bootstrap
inside the ephemeral process. This is not a credential or a production setting.
The harness also reinstates that value before each test because some legacy
tests intentionally remove the variable while exercising authorization setup.

It removes the local cluster on exit and never copies live data. Other Vitest
and Playwright suites remain intentionally excluded because they require a
running workspace service/browser, external behavior, or are outside this
targeted critical gate. A passing release gate is not a claim that the entire
test suite passed.

Chofer is covered by the workspace typecheck, but its custom production build is
not part of this local gate: that build starts Metro on hard-coded port 8081 and
requires deployment-domain inputs, so it conflicts with an already-running
workspace preview and is only reproducible in the isolated Publish builder.

No CI workflow is added by this task. Run and record the gate for the exact
commit proposed for release.

The isolated integration portion can be repeated alone with:

```sh
pnpm run release:check:integration
```

### Current integration result

On 2026-09-21 the full `pnpm run release:check` passed: workspace typecheck,
API/web builds, 49 deterministic tests in 8 files and 84 integration tests in
4 files against an isolated PostgreSQL database. Legacy permission expectations
were updated to assert the intentional denials while retaining positive office,
administrator, linked-driver and assigned-destination reception cases.
The gate does not ignore, invert, or suppress failures.

This does not replace the pending preview sign-in check after real administrator
bootstrap configuration, production Publish validation, or a real backup restore.

`health.test.ts` covers bounded readiness behavior. A direct startup-schema
unit test was not added because `index.ts` performs top-level environment
validation and starts the listener when imported; exercising it as a unit would
start the application rather than remain deterministic. Startup still receives
compile coverage and the isolated schema bootstrap, while a future extraction
of `prepareDatabase` into a side-effect-free module would make direct
migration-skip/fail-closed unit coverage practical.

## Publish checklist

1. Freeze beta changes and record the candidate commit SHA.
2. Run the two commands above and retain their output with the release record.
3. Review the development-to-production schema diff in Publish. Resolve any
   rename prompts deliberately; do not select overwrite-data unless replacing
   production data is explicitly intended and approved.
4. Confirm an owner-approved compute choice. If remaining on autoscale, record
   acceptance that embedded polling/reconciliation has no schedule guarantee.
5. Confirm the recovery owner, proposed objectives, and retention policy in
   `docs/beta-recovery-runbook.md`.
6. The owner initiates Publish. Do not add `db:push`, embedded migrations, or
   other DDL to build/start commands.
7. After Publish, verify health and a read-only critical user journey. Do not
   infer migration success merely from process startup: schema verification
   causes startup to fail if expected tables, columns, or single-column unique
   constraints are absent.

## Cost scenarios (planning estimates)

Inputs supplied from the documented rates:

- Reserved VM, 0.5 vCPU / 2 GiB: **$0.0208/hour**
- database active compute: **$0.16/active hour**
- database storage: **$0.35/GiB-month**
- outbound transfer: **$0.05/GiB**

Using a 720-hour month:

| Scenario | VM | DB active compute | Storage | Outbound | Estimated monthly total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Light: DB active 8 h/day, 10 GiB, 25 GiB outbound | $14.98 | $38.40 | $3.50 | $1.25 | **$58.13** |
| Moderate: DB active 12 h/day, 50 GiB, 200 GiB outbound | $14.98 | $57.60 | $17.50 | $10.00 | **$100.08** |
| Continuously active DB, 10 GiB, 25 GiB outbound | $14.98 | $115.20 | $3.50 | $1.25 | **$134.93** |

These are arithmetic scenarios, not invoices or usage forecasts. Taxes, plan
fees, other services, and actual active-hour behavior are not included. Obtain
owner approval before enabling paid compute.