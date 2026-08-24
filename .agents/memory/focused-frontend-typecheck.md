---
name: Focused frontend typecheck
description: How to avoid false missing-export errors when typechecking one frontend artifact.
---

Before running an artifact-only frontend typecheck, rebuild the shared TypeScript project declarations.

**Why:** Artifact project references resolve shared packages through emitted declaration files. If source codegen is newer than the ignored `dist` declarations, a focused typecheck reports missing hooks, query keys, and fields across otherwise valid code.

**How to apply:** Run the shared-library TypeScript build first (or use the root typecheck, which already does so), then run the focused artifact typecheck.