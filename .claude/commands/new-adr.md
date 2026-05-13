---
description: Scaffold a new Architecture Decision Record
argument-hint: <kebab-case-title>
---

# New ADR: $ARGUMENTS

Scaffold a new ADR file from the template and open it for editing.

## Steps

1. **Find the next ADR number**
   - List files in `docs/adr/` matching `[0-9][0-9][0-9]-*.md`
   - Find the highest number, increment by 1 (zero-padded to 3 digits)

2. **Copy the template**
   - Source: `docs/adr/000-template.md`
   - Destination: `docs/adr/<NNN>-$ARGUMENTS.md`

3. **Fill in initial fields**
   - Replace `NNN` in the title with the computed number
   - Replace `<Title>` with a human-readable version of $ARGUMENTS
   - Set `**Status**: Proposed`
   - Set `**Date**: <today's date in YYYY-MM-DD>`
   - Leave `Deciders` for the human

4. **Report**
   - Print the path to the new file
   - Remind the human: "Fill in Context, Decision, Consequences, Alternatives. Open a PR with `docs(adr): NNN <title>`."

## Don't

- Don't auto-fill the actual decision content. The human writes that.
- Don't commit. Let the human review and commit.
