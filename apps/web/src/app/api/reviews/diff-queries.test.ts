import { describe, expect, it } from "vitest";
import { extractQueries } from "./diff-queries";

const SAMPLE_DIFF = `diff --git a/src/auth/login.ts b/src/auth/login.ts
index 1234..5678 100644
--- a/src/auth/login.ts
+++ b/src/auth/login.ts
@@ -10,5 +10,8 @@ export function login(req: Request) {
-  const session = createSession(userId);
+  const session = createSession(userId, { issuedAt: Date.now() });
+  return audit(session);
 }
`;

describe("extractQueries", () => {
  it("returns [] for an empty diff", () => {
    expect(extractQueries("")).toEqual([]);
    expect(extractQueries("   \n  \n")).toEqual([]);
  });

  it("extracts the file path from a diff --git header", () => {
    const out = extractQueries(SAMPLE_DIFF);
    expect(out).toContain("src/auth/login.ts");
  });

  it("extracts the hunk-header signature", () => {
    const out = extractQueries(SAMPLE_DIFF);
    expect(out.some((q) => q.includes("export function login"))).toBe(true);
  });

  it("includes added/removed identifier tokens like createSession + audit", () => {
    // Bump the cap so both identifiers fit alongside the structural
    // queries (path + hunk + overview).
    const out = extractQueries(SAMPLE_DIFF, { maxQueries: 10 });
    expect(out).toContain("createSession");
    // 'audit' is added on a + line
    expect(out.some((q) => q === "audit")).toBe(true);
  });

  it("drops stop-word tokens like const, function, return", () => {
    const out = extractQueries(SAMPLE_DIFF);
    expect(out).not.toContain("const");
    expect(out).not.toContain("function");
    expect(out).not.toContain("return");
  });

  it("respects the maxQueries cap", () => {
    const out = extractQueries(SAMPLE_DIFF, { maxQueries: 2 });
    expect(out.length).toBeLessThanOrEqual(2);
  });

  it("deduplicates case-insensitively", () => {
    const diff = `diff --git a/a.ts b/a.ts
+const Login = require('./login')
+const login = Login()
`;
    const out = extractQueries(diff);
    const lowered = out.map((q) => q.toLowerCase());
    expect(new Set(lowered).size).toBe(lowered.length);
  });

  it("emits a multi-file overview when several paths change", () => {
    const diff = `diff --git a/a.ts b/a.ts
+x
diff --git a/b.ts b/b.ts
+y
`;
    const out = extractQueries(diff);
    expect(out.some((q) => q.startsWith("changes to "))).toBe(true);
  });

  it("ignores tokens shorter than 3 chars", () => {
    const diff = `diff --git a/a.ts b/a.ts
+x = y
+ab = cd
`;
    const out = extractQueries(diff);
    expect(out).not.toContain("x");
    expect(out).not.toContain("ab");
  });
});
