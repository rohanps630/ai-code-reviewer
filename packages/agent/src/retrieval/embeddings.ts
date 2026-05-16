/**
 * Voyage embeddings client — TypeScript side.
 *
 * The Python indexer (apps/indexer/src/indexer/embeddings.py) embeds
 * chunks at indexing time. This module mirrors that contract on the
 * query side: at retrieval time, we embed the user's query with the
 * same model so the dot product against indexed vectors is meaningful.
 *
 * Voyage tunes the embeddings asymmetrically based on `input_type`:
 *   - indexed chunks  → input_type: "document"
 *   - search queries  → input_type: "query"
 * Get this wrong and recall drops without any error surfacing.
 *
 * Implementation notes:
 *   - Plain `fetch` (no axios — AGENTS.md § 7).
 *   - Retry with exponential backoff on 429 + 5xx + network errors.
 *     Non-retryable 4xx fails immediately.
 *   - Constructor accepts a `fetch` override so tests can inject a
 *     stub without touching the network.
 */

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const DEFAULT_MODEL = "voyage-code-3";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 5;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export type Vector = number[];

export class EmbeddingError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}

export type VoyageClientOptions = {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
};

/** Voyage embeddings client. Use {@link VoyageClient.embedQuery} on the
 *  retrieval path; {@link VoyageClient.embedDocuments} exists for symmetry. */
export class VoyageClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: VoyageClientOptions) {
    if (!opts.apiKey) throw new Error("VoyageClient: apiKey is required");
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  async embedQuery(query: string): Promise<Vector> {
    const vectors = await this.embed([query], "query");
    const first = vectors[0];
    if (!first) throw new EmbeddingError("Voyage returned no vectors for query");
    return first;
  }

  async embedDocuments(texts: string[]): Promise<Vector[]> {
    if (texts.length === 0) return [];
    return this.embed(texts, "document");
  }

  // ── internals ─────────────────────────────────────────────────────

  private async embed(input: string[], inputType: "query" | "document"): Promise<Vector[]> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await this.requestOnce(input, inputType);
      } catch (err) {
        lastError = err;
        if (err instanceof EmbeddingError) {
          // No status = response-shape failure; retrying won't help.
          // With status = HTTP failure; retry only if in the retry set.
          if (err.status === undefined || !RETRYABLE_STATUS.has(err.status)) throw err;
        }
        if (attempt === this.maxAttempts) break;
        await sleep(backoffMs(attempt));
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new EmbeddingError(`Voyage request failed: ${String(lastError)}`);
  }

  private async requestOnce(input: string[], inputType: "query" | "document"): Promise<Vector[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(VOYAGE_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input, model: this.model, input_type: inputType }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const body = await safeText(response);
      throw new EmbeddingError(
        `Voyage returned ${response.status}: ${body.slice(0, 200)}`,
        response.status,
      );
    }

    const payload = (await response.json()) as {
      data?: Array<{ embedding?: unknown }>;
    };
    if (!payload.data || !Array.isArray(payload.data)) {
      throw new EmbeddingError(`Voyage response missing 'data' array`);
    }
    const vectors: Vector[] = [];
    for (const item of payload.data) {
      if (!Array.isArray(item.embedding)) {
        throw new EmbeddingError("Voyage response item missing 'embedding'");
      }
      vectors.push(item.embedding as Vector);
    }
    if (vectors.length !== input.length) {
      throw new EmbeddingError(
        `Voyage returned ${vectors.length} vectors for ${input.length} inputs`,
      );
    }
    return vectors;
  }
}

function backoffMs(attempt: number): number {
  // 500ms, 1s, 2s, 4s, 8s
  return Math.min(8_000, 500 * 2 ** (attempt - 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return response.statusText;
  }
}
