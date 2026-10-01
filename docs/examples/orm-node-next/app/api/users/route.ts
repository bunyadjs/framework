/**
 * Example App Router Route Handler — server-only Bunyad query.
 * Copy under `app/api/users/route.ts` in a Next.js (Node) app.
 *
 * Models: use Bunyad `Model` subclasses from your app; do not invent Nest/Prisma entities.
 */
import { NextResponse } from "next/server";
import { db } from "../../../db.ts";

export const runtime = "nodejs"; // Edge out of scope — native DB drivers need Node

export async function GET() {
  // Query builder example (swap for Model.query() once models are defined).
  const users = await db().table("users").limit(10).get();
  return NextResponse.json({ users });
}
