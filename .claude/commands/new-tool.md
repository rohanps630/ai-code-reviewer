---
description: Scaffold a new agent tool with tests and registration
argument-hint: <tool-name>
---

# New agent tool: $ARGUMENTS

⚠️ **Tool implementations under `packages/agent/src/tools/` are part of the protected hand-written core.** Do not write the actual logic. Your job here is to scaffold the file structure, types, and tests so the human can fill in the implementation.

## Steps

1. **Read context first**
   - Read `AGENTS.md` § 7 (Never do) and § 8 (Where to find things)
   - Read `packages/agent/src/tools/index.ts` to see existing tool registration
   - Read one existing tool file (e.g. `search-code.ts`) for the established pattern

2. **Create the tool file**
   - Path: `packages/agent/src/tools/$ARGUMENTS.ts`
   - Export:
     - A Zod schema for the tool's input
     - A Zod schema for the tool's output
     - A `toolDefinition` object matching the existing pattern (name, description, input_schema)
     - A stub `execute` function that throws `new Error("Not implemented")`
   - Add a JSDoc block above `toolDefinition` describing **when the model should use this tool**. This becomes part of the prompt — write it carefully.

3. **Register the tool**
   - Add an export to `packages/agent/src/tools/index.ts`
   - Do not modify `loop.ts` — registration is automatic via the index

4. **Create tests**
   - Path: `packages/agent/tests/tools/$ARGUMENTS.test.ts`
   - Test cases:
     - Input validation rejects invalid shapes
     - Output validation rejects invalid shapes
     - `execute` currently throws `Not implemented` (sanity check before implementation)

5. **Update docs**
   - Add a row to the tools table in `docs/architecture.md`
   - Do **not** modify `docs/prompts.md` (that's for prompt changes)

6. **Stop and report**
   - List the files created
   - Tell the human: "Scaffold complete. The `execute` function in `$ARGUMENTS.ts` is a stub — implement it manually."
   - Do not commit. Let the human review first.

## Don't

- Don't implement `execute`. That's hand-written by the human.
- Don't modify `loop.ts`.
- Don't modify any prompt files.
- Don't write tests that mock the LLM.
