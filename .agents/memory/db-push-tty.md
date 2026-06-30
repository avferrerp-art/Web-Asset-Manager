---
name: DB push TTY prompt
description: drizzle-kit push fails in non-TTY when removing columns; use direct SQL instead
---

When schema changes remove or rename columns, `drizzle-kit push` tries to interactively prompt
about conflicts (columnsResolver). This requires a TTY and fails in the bash sandbox even with
`yes '' |` piped input.

**How to apply:** Instead of running `db push`, apply the DDL directly via:
```js
await executeSql({ sqlQuery: "ALTER TABLE ... ADD COLUMN ...; CREATE TABLE IF NOT EXISTS ..." });
```
Then verify the schema matches by checking `information_schema.columns`.

**Why:** The drizzle-kit interactive prompt uses a renderer that checks `process.stdin.isTTY`.
Adding new columns (no conflict) works fine with `db push`. Only column removal/rename triggers this.
