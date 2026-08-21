---
name: Shared-DB transfer tests
description: Why transfer integration tests that exercise historical Odoo reconciliation cannot safely run beside unrelated transfer fixtures.
---

Transfer integration tests that run historical Odoo reconciliation must not execute in parallel with another test file that creates local transfer mirrors.

**Why:** The reconciliation intentionally removes local deliveries missing from its mocked Odoo id set. Because Vitest files share the same development database, it can delete another file's freshly-created fixtures and produce misleading ordering, search, and empty-detail failures.

**How to apply:** Run transfer integration files serially, or ensure the reconciliation mock protects all pre-existing Odoo ids after every concurrent fixture has been created. Do not diagnose those cross-file deletions as transfer query regressions.