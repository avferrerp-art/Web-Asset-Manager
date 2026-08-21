---
name: OpenAPI date coercion
description: Runtime validation caveat for generated Zod request schemas with date-time fields and closed objects.
---

Generated request schemas may use date coercion, which turns `null` or numeric input into a valid `Date`, and object parsing may strip unknown keys even when OpenAPI declares `additionalProperties: false`.

**Why:** Relying only on generated parsing can fabricate an epoch timestamp or silently accept extra write fields, violating the source contract without a type error.

**How to apply:** For write endpoints with required date-time strings or closed bodies, validate the raw JSON value and allowed keys before consuming the generated parsed object. Keep the generated files untouched.