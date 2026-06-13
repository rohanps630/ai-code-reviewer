/**
 * Re-export of the shared Upstash Redis client.
 *
 * The implementation lives in `@acr/shared/redis` so the worker (cache write)
 * and the web API (cache read) share one client. Import sites in this app keep
 * using `@/lib/redis` unchanged.
 */
export { RedisClient, redis } from "@acr/shared/redis";
