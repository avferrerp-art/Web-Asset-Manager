import { getAuth, clerkClient } from "@clerk/express";
import { db, personnelTable, type Personnel } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { Request } from "express";

export type CurrentPersonResult =
  | { ok: true; person: Personnel }
  | {
      ok: false;
      reason: "unauthorized" | "no_email" | "not_linked";
      email?: string;
    };

export async function resolveCurrentPerson(
  req: Request,
): Promise<CurrentPersonResult> {
  const userId = getAuth(req)?.userId;
  if (!userId) return { ok: false, reason: "unauthorized" };

  const user = await clerkClient.users.getUser(userId);
  const email =
    user.primaryEmailAddress?.emailAddress ??
    user.emailAddresses[0]?.emailAddress;
  if (!email) return { ok: false, reason: "no_email" };

  const [person] = await db
    .select()
    .from(personnelTable)
    .where(sql`lower(${personnelTable.email}) = ${email.toLowerCase()}`);
  return person
    ? { ok: true, person }
    : { ok: false, reason: "not_linked", email };
}