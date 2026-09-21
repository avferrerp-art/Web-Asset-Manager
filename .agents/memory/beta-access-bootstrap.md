---
name: Beta access bootstrap
description: Explicit administrator identity and safe rollout of restrictive permissions
---

Never infer the administrator from the first authenticated user or a personnel
row without an explicitly linked identity. Before activating restrictive
authorization, verify that the owner has configured the administrator allowlist
and deliberately linked operational users to personnel.

**Why:** the pre-beta data could contain personnel records without account
emails. Enforcing roles without bootstrap would lock out legitimate users;
granting access to an arbitrary unlinked account would be a security bypass.

**How to apply:** use the environment configuration flow for the administrator
allowlist, do not store personal addresses in project memory, and treat missing
bootstrap as a setup blocker rather than silently granting full access.