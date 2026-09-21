---
name: Database schema ownership
description: Development migrations versus Replit-managed production schema changes
---
For Replit-managed PostgreSQL, production DDL belongs to the Publish schema-diff flow. Do not add startup or build-time production migrations. Embedded migrations may support development only; production startup verifies schema read-only.

**Why:** previous guidance recommended boot migrations after constraints were lost during merges. That workaround conflicts with the current managed database contract and can mutate production unexpectedly. The schema source of truth must include all required constraints so Publish can carry them forward.

**How to apply:** read the current database migration-on-publish skill, apply schema changes to development through the supported dev flow, and have the owner review the Publish diff. Never resolve a production schema mismatch by enabling boot DDL. External databases require a separately verified migration process.
