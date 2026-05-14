/**
 * Prompt exports — always points to the current active version.
 *
 * ⚠️  PROTECTED FILE — see AGENTS.md § 7.
 * To bump the prompt: create a new version file, update the import below,
 * and log the change in docs/prompts.md with eval delta.
 */
export { SYSTEM_PROMPT_V01 as CURRENT_SYSTEM_PROMPT } from "./versions/system-v0.1.js";

/** The currently active prompt version string. */
export const CURRENT_PROMPT_VERSION = "v0.1";
