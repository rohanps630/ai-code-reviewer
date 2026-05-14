/**
 * Langfuse client singleton.
 *
 * Returns a configured Langfuse client when LANGFUSE_PUBLIC_KEY and
 * LANGFUSE_SECRET_KEY are present, otherwise null. Callers should
 * guard before tracing so the app stays functional without observability
 * credentials configured (e.g. local dev).
 */
import { Langfuse } from "langfuse";

import { serverEnv } from "@/lib/env";

let cached: Langfuse | null | undefined;

export function getLangfuse(): Langfuse | null {
  if (cached !== undefined) return cached;

  if (!serverEnv.LANGFUSE_PUBLIC_KEY || !serverEnv.LANGFUSE_SECRET_KEY) {
    cached = null;
    return cached;
  }

  cached = new Langfuse({
    publicKey: serverEnv.LANGFUSE_PUBLIC_KEY,
    secretKey: serverEnv.LANGFUSE_SECRET_KEY,
    baseUrl: serverEnv.LANGFUSE_HOST,
  });
  return cached;
}
