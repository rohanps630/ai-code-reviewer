/**
 * Voyage TS client tests.
 * Inject a stub `fetch` so no HTTP touches the wire.
 */

import { describe, expect, it } from "vitest";
import { EmbeddingError, VoyageClient } from "../../src/retrieval/embeddings.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeFetch(handler: (req: Request) => Response | Promise<Response>): typeof fetch {
  return async (input, init) => {
    const req = new Request(input as RequestInfo, init);
    return handler(req);
  };
}

describe("VoyageClient", () => {
  it("rejects construction without an api key", () => {
    expect(() => new VoyageClient({ apiKey: "" })).toThrow();
  });

  it("embedQuery returns the first vector and sends input_type=query", async () => {
    const seen: unknown[] = [];
    const fetchImpl = makeFetch(async (req) => {
      seen.push(await req.json());
      return jsonResponse({ data: [{ embedding: Array(1024).fill(0.1) }] });
    });
    const client = new VoyageClient({ apiKey: "k", fetchImpl });
    const vec = await client.embedQuery("how does auth work?");

    expect(vec).toHaveLength(1024);
    expect(seen[0]).toMatchObject({
      input: ["how does auth work?"],
      input_type: "query",
      model: "voyage-code-3",
    });
  });

  it("embedDocuments returns one vector per input with input_type=document", async () => {
    const fetchImpl = makeFetch(async (req) => {
      const body = (await req.json()) as { input: string[] };
      expect(body.input_type).toBe("document");
      return jsonResponse({
        data: body.input.map(() => ({ embedding: Array(1024).fill(0) })),
      });
    });
    const client = new VoyageClient({ apiKey: "k", fetchImpl });
    const out = await client.embedDocuments(["a", "b", "c"]);
    expect(out).toHaveLength(3);
  });

  it("retries on 503 then succeeds", async () => {
    let calls = 0;
    const fetchImpl = makeFetch(async () => {
      calls += 1;
      if (calls < 3) return new Response("busy", { status: 503 });
      return jsonResponse({ data: [{ embedding: [0.1] }] });
    });
    const client = new VoyageClient({ apiKey: "k", fetchImpl });
    await client.embedQuery("hi");
    expect(calls).toBe(3);
  });

  it("does not retry on 401", async () => {
    let calls = 0;
    const fetchImpl = makeFetch(async () => {
      calls += 1;
      return new Response("bad key", { status: 401 });
    });
    const client = new VoyageClient({ apiKey: "k", fetchImpl });
    await expect(client.embedQuery("hi")).rejects.toBeInstanceOf(EmbeddingError);
    expect(calls).toBe(1);
  });

  it("raises after exhausting retries on 503", async () => {
    let calls = 0;
    const fetchImpl = makeFetch(async () => {
      calls += 1;
      return new Response("busy", { status: 503 });
    });
    const client = new VoyageClient({ apiKey: "k", fetchImpl, maxAttempts: 3 });
    await expect(client.embedQuery("hi")).rejects.toBeInstanceOf(EmbeddingError);
    expect(calls).toBe(3);
  });

  it("rejects responses with no 'data' array", async () => {
    const fetchImpl = makeFetch(async () => jsonResponse({ unexpected: true }));
    const client = new VoyageClient({ apiKey: "k", fetchImpl });
    await expect(client.embedQuery("hi")).rejects.toBeInstanceOf(EmbeddingError);
  });

  it("rejects mismatched vector counts", async () => {
    const fetchImpl = makeFetch(async () => jsonResponse({ data: [{ embedding: [1] }] }));
    const client = new VoyageClient({ apiKey: "k", fetchImpl });
    await expect(client.embedDocuments(["a", "b"])).rejects.toBeInstanceOf(EmbeddingError);
  });
});
