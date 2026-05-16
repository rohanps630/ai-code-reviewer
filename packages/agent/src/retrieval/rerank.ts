/**
 * Cohere cross-encoder reranker.
 *
 * Hybrid retrieval (BM25 + vector → RRF) is good at recall: it pulls
 * the right chunks into the top ~30. It's worse at precision: among
 * those 30, the most relevant might sit at rank 12. A cross-encoder
 * rerank fixes that — Cohere `rerank-v3.5` reads each (query, chunk)
 * pair end-to-end and assigns a relevance score the bi-encoder can't
 * produce.
 *
 * Pipeline position:
 *   searchCode() runs hybrid retrieval → top 30 (default).
 *   If a CohereReranker is configured, those 30 go through `.rerank()`
 *   and we return the top 10 by Cohere's relevance_score. The original
 *   BM25 / vector / RRF ranks stay attached as breadcrumbs.
 *
 * Why Cohere `rerank-v3.5`:
 *   - It's the canonical cross-encoder in 2026; multilingual + strong
 *     on code-adjacent text.
 *   - The `rerank-3` family name is locked in via ADR-001; the actual
 *     model identifier is `rerank-v3.5` (Cohere's versioning).
 *
 * Failure model mirrors VoyageClient: retry on 429 + 5xx with
 * exponential backoff, non-retryable 4xx + shape errors fail fast.
 * Injectable fetch for tests.
 */

import type { SearchResult } from "./types.js";

const COHERE_API_URL = "https://api.cohere.com/v2/rerank";
const DEFAULT_MODEL = "rerank-v3.5";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 5;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export class RerankError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "RerankError";
  }
}

export type CohereRerankerOptions = {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
};

export type RerankOptions = {
  /** Final result count. Default: keep all reranked candidates. */
  topN?: number;
};

/** Contract the orchestrator uses; lets us swap Cohere for another
 *  reranker (or a stub) without touching hybrid.ts. */
export interface Reranker {
  rerank(query: string, hits: SearchResult[], options?: RerankOptions): Promise<SearchResult[]>;
}

export class CohereReranker implements Reranker {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: CohereRerankerOptions) {
    if (!opts.apiKey) throw new Error("CohereReranker: apiKey is required");
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  async rerank(
    query: string,
    hits: SearchResult[],
    options: RerankOptions = {},
  ): Promise<SearchResult[]> {
    if (hits.length === 0) return [];
    const trimmed = query.trim();
    if (!trimmed) return hits.slice(0, options.topN ?? hits.length);

    // We feed Cohere `content_with_context` (chunk + Anthropic-style
    // contextual prefix) so the cross-encoder has the same orientation
    // signal the embedder did.
    const documents = hits.map((h) => h.contentWithContext);
    const topN = options.topN ?? hits.length;

    const ranked = await this.requestWithRetry(trimmed, documents, topN);

    // Map Cohere's (index, relevance_score) back to our SearchResult,
    // attaching cohereScore / cohereRank as breadcrumbs.
    const out: SearchResult[] = [];
    ranked.forEach((result, finalRank) => {
      const original = hits[result.index];
      if (!original) return;
      out.push({
        ...original,
        cohereScore: result.relevance_score,
        cohereRank: finalRank + 1,
      });
    });
    return out;
  }

  // ── internals ─────────────────────────────────────────────────────

  private async requestWithRetry(
    query: string,
    documents: string[],
    topN: number,
  ): Promise<CohereRerankResult[]> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await this.requestOnce(query, documents, topN);
      } catch (err) {
        lastError = err;
        if (err instanceof RerankError) {
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
      : new RerankError(`Cohere request failed: ${String(lastError)}`);
  }

  private async requestOnce(
    query: string,
    documents: string[],
    topN: number,
  ): Promise<CohereRerankResult[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(COHERE_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          query,
          documents,
          top_n: Math.min(topN, documents.length),
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const body = await safeText(response);
      throw new RerankError(
        `Cohere returned ${response.status}: ${body.slice(0, 200)}`,
        response.status,
      );
    }

    const payload = (await response.json()) as { results?: unknown };
    if (!Array.isArray(payload.results)) {
      throw new RerankError("Cohere response missing 'results' array");
    }

    const out: CohereRerankResult[] = [];
    for (const item of payload.results) {
      if (
        typeof item !== "object" ||
        item === null ||
        typeof (item as { index?: unknown }).index !== "number" ||
        typeof (item as { relevance_score?: unknown }).relevance_score !== "number"
      ) {
        throw new RerankError("Cohere result item missing index/relevance_score");
      }
      const i = (item as { index: number }).index;
      if (i < 0 || i >= documents.length) {
        throw new RerankError(`Cohere returned out-of-range index ${i}`);
      }
      out.push({
        index: i,
        relevance_score: (item as { relevance_score: number }).relevance_score,
      });
    }
    return out;
  }
}

type CohereRerankResult = { index: number; relevance_score: number };

function backoffMs(attempt: number): number {
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
