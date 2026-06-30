---
name: API server restart after codegen or schema changes
description: The API server must be manually restarted whenever lib packages change (codegen, Drizzle schema, etc.) because it compiles a static bundle at startup.
---

After running `pnpm --filter @workspace/api-spec run codegen` or `pnpm --filter @workspace/db run push`, the API server does NOT hot-reload. It runs from a compiled esbuild bundle (`dist/index.mjs`) built once at startup.

**Rule:** Always call `restart_workflow("artifacts/api-server: API Server")` after any of these:
- Codegen (`@workspace/api-spec run codegen`) — Zod schemas and TypeScript types change
- DB schema changes (`@workspace/db run push`) — table structure changes
- Any change to a `lib/*` package that the API server imports

**Why:** The dev command is `pnpm run build && pnpm run start` — it builds once and stays running. Lib changes are invisible to the running process until a rebuild.

**How to apply:** After codegen + db push, immediately call `restart_workflow`. Then verify with a curl test before confirming to the user that changes work.
