import { repos } from "@acr/db";
import { z } from "zod";

import { checkAccessKey } from "@/lib/access-key";
import { applyRateLimit } from "@/lib/rate-limit";

// ────────────────────────────────────────────────────────────────────
// Zod validation — external boundary
// ────────────────────────────────────────────────────────────────────

const CreateRepoBody = z.object({
  url: z
    .string()
    .trim()
    .regex(
      /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/?$/,
      "Must be a GitHub repo URL: https://github.com/<owner>/<name>",
    ),
});

function parseGitHubUrl(url: string): { owner: string; name: string; canonicalUrl: string } {
  // Remove trailing slash for canonical form
  const canonical = url.replace(/\/+$/, "");
  const parts = new URL(canonical).pathname.split("/").filter(Boolean);
  return {
    owner: parts[0] ?? "",
    name: parts[1] ?? "",
    canonicalUrl: canonical,
  };
}

// ────────────────────────────────────────────────────────────────────
// POST /api/repos — connect a repo for indexing
// ────────────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  // Auth: check ACCESS_KEY if configured
  const denied = checkAccessKey(req);
  if (denied) return denied;

  const rl = await applyRateLimit(req);
  if (!rl.success) {
    return Response.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateRepoBody.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request body", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { owner, name, canonicalUrl } = parseGitHubUrl(parsed.data.url);

  const { db } = await import("@acr/db/client");

  // Upsert-like: try insert; if unique constraint fires, return 409.
  try {
    const [row] = await db
      .insert(repos)
      .values({
        url: canonicalUrl,
        owner,
        name,
        status: "pending",
      })
      .returning({
        id: repos.id,
        url: repos.url,
        owner: repos.owner,
        name: repos.name,
        status: repos.status,
      });

    return Response.json(row, { status: 201 });
  } catch (err: unknown) {
    // Postgres unique violation = 23505
    if (isUniqueViolation(err)) {
      return Response.json({ error: "Repo already connected", url: canonicalUrl }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "Internal error";
    return Response.json({ error: message }, { status: 500 });
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  // Drizzle / pg drivers expose `code` on constraint violation errors.
  return "code" in err && (err as { code: string }).code === "23505";
}
