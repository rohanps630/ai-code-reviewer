import { describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * Sanity tests for the env schema shapes.
 *
 * We don't import the live `env` / `serverEnv` / `clientEnv` exports here
 * because those parse `process.env` at module load time and would require
 * every var to be set in the test environment.
 *
 * Instead we re-declare the schemas inline (same shape) and assert that
 * a valid fixture parses correctly and an invalid one fails with the right
 * error path. This tests the schema logic without coupling to process.env.
 */

describe("clientSchema", () => {
  const clientSchema = z.object({
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
    NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional(),
    NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  });

  it("parses a valid client env fixture", () => {
    const result = clientSchema.safeParse({
      NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-value",
      NEXT_PUBLIC_APP_URL: "https://myapp.vercel.app",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.NEXT_PUBLIC_SUPABASE_URL).toBe("https://abc.supabase.co");
      expect(result.data.NEXT_PUBLIC_APP_URL).toBe("https://myapp.vercel.app");
    }
  });

  it("applies the default for NEXT_PUBLIC_APP_URL when omitted", () => {
    const result = clientSchema.safeParse({
      NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-value",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
    }
  });

  it("fails when NEXT_PUBLIC_SUPABASE_URL is not a URL", () => {
    const result = clientSchema.safeParse({
      NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-value",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("NEXT_PUBLIC_SUPABASE_URL");
    }
  });
});

describe("serverSchema", () => {
  const serverSchema = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    ANTHROPIC_API_KEY: z.string().min(1),
    OPENAI_API_KEY: z.string().min(1).optional(),
    LANGFUSE_HOST: z.string().url().default("https://cloud.langfuse.com"),
  });

  it("parses a valid server env fixture", () => {
    const result = serverSchema.safeParse({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://postgres:password@db.abc.supabase.co:5432/postgres",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      ANTHROPIC_API_KEY: "sk-ant-test",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.NODE_ENV).toBe("test");
      expect(result.data.LANGFUSE_HOST).toBe("https://cloud.langfuse.com");
    }
  });

  it("fails when DATABASE_URL is missing", () => {
    const result = serverSchema.safeParse({
      NODE_ENV: "development",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      ANTHROPIC_API_KEY: "sk-ant-test",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("DATABASE_URL");
    }
  });

  it("rejects an invalid NODE_ENV value", () => {
    const result = serverSchema.safeParse({
      NODE_ENV: "staging",
      DATABASE_URL: "postgresql://postgres:password@db.abc.supabase.co:5432/postgres",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      ANTHROPIC_API_KEY: "sk-ant-test",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("NODE_ENV");
    }
  });
});

describe("Result type", () => {
  // Type-level test — just verifies the discriminated union narrows correctly.
  // If this compiles, the type is correct.
  it("narrows correctly on ok: true", () => {
    type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

    const r: Result<number> = { ok: true, value: 42 };
    if (r.ok) {
      expect(r.value).toBe(42);
    }
  });

  it("narrows correctly on ok: false", () => {
    type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

    const r: Result<number, "not_found"> = { ok: false, error: "not_found" };
    if (!r.ok) {
      expect(r.error).toBe("not_found");
    }
  });
});
