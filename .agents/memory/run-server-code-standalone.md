---
name: Run api-server service functions standalone
description: How to execute a single api-server service function outside the HTTP server (e.g. to test auth-protected endpoints' logic)
---
API routes are Clerk-protected, so curl gets 401. To exercise a service function directly (e.g. Odoo sync), bundle a tiny entry script with esbuild using the same setup as `artifacts/api-server/build.mjs` — crucially including `esbuild-plugin-pino({ transports: ['pino-pretty'] })` and the createRequire banner — then run the output with node from the api-server dir.

**Why:** tsx is not installed; plain esbuild bundles fail on pino transports (ERR_AMBIGUOUS_MODULE_SYNTAX) and `packages: 'external'` fails on workspace dir imports. Only the build.mjs pattern works.

**How to apply:** whenever you need to run/verify backend logic without going through authenticated HTTP. If the entry is supplied through esbuild `stdin`, the Pino plugin creates multiple entry points: use `outdir` (not `outfile`) and run the generated `stdin.mjs`.
