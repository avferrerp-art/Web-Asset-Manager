---
name: Clerk auth setup
description: How auth is wired in LogiFleet and what not to change
---

- App uses Replit-managed Clerk (cookie-based on web). Canonical wiring in `App.tsx` (publishableKeyFromHost, unconditional proxyUrl, `/sign-in/*?` routes) must be kept verbatim — no PROD/NODE_ENV gates, no Bearer tokens in browser code.
- **API protection is ordering-based**: in the API routes index, `healthRouter` is mounted before the `requireAuth` middleware; everything mounted after is auth-gated. Any new public endpoint must be mounted before `requireAuth`; any new router added at the end is automatically protected.
- **Why:** relying on ordering means a route added above `requireAuth` silently becomes public — check placement when adding routers.
- Dev shows `pk_test` keys and "development keys" console warnings — expected, do not "fix".
