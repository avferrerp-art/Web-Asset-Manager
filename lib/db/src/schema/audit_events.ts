import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Security audit metadata only. Request bodies, emails, tokens and other
 * payload data must never be stored here.
 */
export const auditEventsTable = pgTable("audit_events", {
  id: serial("id").primaryKey(),
  actorId: text("actor_id"),
  action: text("action").notNull(),
  resource: text("resource").notNull(),
  targetId: integer("target_id"),
  result: text("result").notNull(),
  // Null while the authorized operation is in flight. A durable intent is
  // inserted before the route handler can mutate application state.
  statusCode: integer("status_code"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AuditEvent = typeof auditEventsTable.$inferSelect;