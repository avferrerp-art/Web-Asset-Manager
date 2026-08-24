---
name: Personnel warehouse migration test
description: Why the personnel-to-warehouse migration test must not rewrite constraints on the populated development table.
---

The migration-repeatability case for personnel warehouse assignments must run in an isolated schema or against dedicated temporary tables, not against the populated public relationship table.

**Why:** The case temporarily changes the valid composite primary key to a single-person key. That DDL necessarily fails whenever any real person already has more than one warehouse assignment, even though the application and migration are correct.

**How to apply:** Keep ordinary service/API fixtures on the shared development database, but move destructive constraint-shape simulation into a transaction-local schema with self-contained personnel and warehouse tables.