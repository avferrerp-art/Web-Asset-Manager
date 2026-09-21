export const name = "0021_audit_events";
export const developmentOnly = true;

export const sql = `
CREATE TABLE IF NOT EXISTS "audit_events" (
  "id" serial PRIMARY KEY,
  "actor_id" text,
  "action" text NOT NULL,
  "resource" text NOT NULL,
  "target_id" integer,
  "result" text NOT NULL,
  "status_code" integer,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
`;