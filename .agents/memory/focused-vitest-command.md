---
name: Focused Vitest command
description: How to run only selected API E2E files without accidentally selecting the whole suite.
---

Run focused API tests with `pnpm --filter @workspace/e2e exec vitest run --config vitest.config.ts tests/<file>.test.ts`.

**Why:** Passing a file after the `test:api` package script's argument separator unexpectedly ran every configured Vitest file, surfacing unrelated known authentication failures and obscuring the targeted result.

**How to apply:** Use the direct `exec vitest` form for one or a few selected API test files; reserve the package script without file arguments for an intentional full-suite run.