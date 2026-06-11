# Event Stream Contract: `AgentEvent` -> `ReviewChunk`

This document defines the formal contract for the agent execution event stream, mapping internal agent execution state to the client-facing NDJSON stream.

## 1. Internal Stream: `AgentEvent`
- **Source**: `packages/agent/src/agent.ts` runtime `stream()` generator.
- **Purpose**: A typed sequence representing the internal state machine of the generic `Agent` loop.

## 2. Public Stream: `ReviewChunk`
- **Source**: `packages/agent/src/loop.ts` (`runReview` specialization).
- **Transport**: Newline-delimited JSON (NDJSON) over streamed HTTP response (`Content-Type: application/x-ndjson`).
- **Endpoint**: `POST /api/reviews`
- **Purpose**: The mapped, external-facing events sent to the web client.

## 3. Streaming and Parsing Rules
1. **No External Frameworks**: The transport relies on standard NDJSON over HTTP, explicitly avoiding the Vercel AI SDK or raw WebSockets.
2. **Client Parsing**: The web client parses the NDJSON stream line-by-line (`apps/web/src/components/features/reviews/use-review-stream.ts`).
3. **Progressive UI**: The stream powers a progressively updated UI where tool execution states are shown in a timeline, while markdown output is rendered in the main column.

## 4. Persistence and Replay Contract
1. **Teeing to Database**: As the stream emits, each `ReviewChunk` must be teed into the `agent_events` Postgres table. This is best-effort, batched, and retains a strict sequential (`seq`) order.
2. **State Reconstruction**: The review detail UI reconstructs the entire run from the `agent_events` table using the **exact same reducer** (`review-stream-state.ts`) used during the live stream.
3. **Replay Invariant**: A review replayed from the database must yield the identical state tree and UI representation as the live run.
4. **API Access**: Persisted events must be accessible via `GET /api/reviews/[id]/events`.

## Violation Risks
- Breaking the NDJSON delimiter format will crash the client parser.
- Desync between `runReview` emissions and `review-stream-state.ts` reducer will cause live UI and replayed UI to diverge, breaking the replay invariant.
