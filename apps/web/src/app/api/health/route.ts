import { sql } from "@acr/db";
import { db } from "@acr/db/client";

import { stringifyError } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * GET /api/health
 *
 * Liveness + dependency check for load balancers and uptime monitors.
 * Verifies the process is up *and* can reach Postgres (a 200 from a process
 * that can't query its DB is a false positive). Intentionally unauthenticated
 * and uncached so probes always hit live state.
 */
export async function GET(): Promise<Response> {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ status: "ok", db: "up" }, { status: 200 });
  } catch (err) {
    return Response.json(
      { status: "degraded", db: "down", error: stringifyError(err) },
      { status: 503 },
    );
  }
}
