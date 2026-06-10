/**
 * Schema barrel — aggregates all table definitions for Drizzle Kit
 * and for consumers that need the full schema object.
 *
 * Convention: one table per file, re-exported here.
 * Add new Phase 2+ tables as separate files and re-export below.
 */
export { reviews } from "./reviews.js";

// Phase 2 — retrieval
export { repos } from "./repos.js";
export { documents } from "./documents.js";
export { chunks } from "./chunks.js";

// Phase 5 — production concerns
export { semanticCache } from "./semantic_cache.js";

// Run/step replay (PR 2)
export { agentEvents } from "./agent_events.js";
