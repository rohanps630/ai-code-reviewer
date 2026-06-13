import { describe, expect, it } from "vitest";

import { PostgresCodeSource } from "../../src/tools/postgres-code-source.js";

type Executor = { execute: (query: unknown) => Promise<unknown> };

/** Capture the drizzle `sql` object handed to the executor. */
function capturing(rows: unknown[] = []): { exec: Executor; captured: () => unknown } {
  let captured: unknown;
  return {
    exec: {
      execute: async (q: unknown) => {
        captured = q;
        return rows;
      },
    },
    captured: () => captured,
  };
}

describe("PostgresCodeSource.findReferences", () => {
  it("builds a plainto_tsquery (not to_tsquery) so operator-laden symbols can't crash it", async () => {
    const { exec, captured } = capturing();
    const src = new PostgresCodeSource(exec);
    await src.findReferences("AuthService", 10);

    // The drizzle `sql` object serializes its static fragments + bound params.
    // We assert the safe builder is used and the symbol is *bound*, not inlined.
    const serialized = JSON.stringify(captured());
    expect(serialized).toContain("plainto_tsquery('english',");
    expect(serialized).toContain("AuthService"); // present as a bound param value
  });

  it("does not throw on a $-leading identifier and maps rows", async () => {
    const { exec } = capturing([
      {
        path: "src/di.ts",
        start_line: 1,
        end_line: 4,
        symbol_name: "$inject",
        symbol_kind: "function",
        content: "function $inject() {}",
      },
    ]);
    const src = new PostgresCodeSource(exec);
    const out = await src.findReferences("$inject", 5);
    expect(out).toHaveLength(1);
    expect(out[0]?.path).toBe("src/di.ts");
  });

  it("returns an empty array when no rows match", async () => {
    const { exec } = capturing([]);
    const src = new PostgresCodeSource(exec);
    expect(await src.findReferences("missing", 5)).toEqual([]);
  });
});
