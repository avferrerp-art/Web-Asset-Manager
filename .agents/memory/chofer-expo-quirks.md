---
name: Expo mobile quirks
description: Lessons from building the Expo driver app against the generated API client.
---

- **Orval/React Query in Expo:** generated hooks' `query` options are typed to require `queryKey` in this setup — always pass the exported `get...QueryKey()` helper (e.g. `useGetDriverMe({ query: { queryKey: getGetDriverMeQueryKey(), retry: false } })`).
  **Why:** typecheck fails with TS2741 otherwise.
- **@types/react versions:** the workspace catalog must pin `@types/react` to Expo's expected `~19.1.x` (and `@types/react-dom` `~19.1.x`); mixing with `^19.2` splits versions and breaks the full typecheck.
- **Mobile auth:** web uses Clerk cookies; the Expo app uses Bearer tokens via `setAuthTokenGetter` + `setBaseUrl` in the root layout. Server routes stay unchanged.
- **Sign-out hygiene:** call `queryClient.clear()` after `signOut()` so a next user on the same device never sees cached data.
- **Error typing:** the api-client package does not export `ApiError`; cast errors to a local `{ status?: number; data?: { message?: string } }` shape.
- **pnpm minimumReleaseAge** can silently keep an older patch (e.g. expo 54.0.35 vs 54.0.36); the Expo version warning is cosmetic — don't fight it.
