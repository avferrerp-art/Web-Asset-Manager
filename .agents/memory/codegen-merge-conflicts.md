---
name: Generated API files break on task merges
description: What to do when a task merge leaves duplicate exports in Orval-generated files
---

Task merges can leave duplicate blocks in the Orval-generated files (`lib/api-zod/src/generated/api.ts`, `lib/api-client-react/src/generated/api.ts`), breaking both server build and Vite with "Multiple exports with the same name".

**Why:** both branches ran codegen and the merge concatenated the generated output instead of picking one side.

**How to apply:** never hand-edit generated files. Re-run `pnpm --filter @workspace/api-spec run codegen` from the merged OpenAPI spec, then fix frontend call sites that were written against the other branch's parameter/type names, and remove any unregistered duplicate route files. Verify with `pnpm run typecheck`.
