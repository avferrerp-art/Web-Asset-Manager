---
name: Retiring migration-owned columns
description: Keep the whole migration chain repeatable when a later migration removes columns introduced by an earlier one
---

When a later migration permanently retires columns, remove their `ADD COLUMN IF NOT EXISTS` statements from earlier repeatable migrations once the later migration can safely handle both column-present and column-absent databases.

**Why:** Re-running an older migration after the cleanup can otherwise resurrect obsolete columns even though the newer migration is already marked applied, leaving the live schema out of sync with the application.

**How to apply:** Make the cleanup migration tolerate absent columns, then test the earlier migration again after cleanup and assert the retired columns remain absent.