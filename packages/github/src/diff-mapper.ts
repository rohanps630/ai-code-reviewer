import type { PrFile } from "./pr-fetcher.js";

export interface CommentableLocation {
  path: string;
  line: number;
  side: "RIGHT" | "LEFT";
  start_line?: number;
  start_side?: "RIGHT" | "LEFT";
}

export type MappedFinding =
  | {
      kind: "inline";
      path: string;
      line: number;
      side: "RIGHT" | "LEFT";
      start_line?: number;
      start_side?: "RIGHT" | "LEFT";
    }
  | { kind: "demoted"; reason: string };

export interface FindingInput {
  severity: string;
  category: string;
  summary: string;
  locationHint?: string;
  suggestion?: string;
}

export class CommentableSet {
  // Map of path -> Map of side -> Set of line numbers
  private lines = new Map<string, { RIGHT: Set<number>; LEFT: Set<number> }>();

  constructor(files: PrFile[]) {
    for (const file of files) {
      if (!file.patch) continue;

      const rightLines = new Set<number>();
      const leftLines = new Set<number>();

      const hunkRegex = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/gm;
      let match: RegExpExecArray | null = hunkRegex.exec(file.patch);
      let lastIndex = 0;
      const hunks: { oldStart: number; newStart: number; content: string }[] = [];

      while (match !== null) {
        if (lastIndex > 0 && hunks.length > 0) {
          const lastHunk = hunks[hunks.length - 1];
          if (lastHunk) {
            lastHunk.content = file.patch.slice(lastIndex, match.index);
          }
        }
        hunks.push({
          oldStart: Number.parseInt(match[1] as string, 10),
          newStart: Number.parseInt(match[2] as string, 10),
          content: "",
        });
        lastIndex = hunkRegex.lastIndex;
        match = hunkRegex.exec(file.patch);
      }
      if (hunks.length > 0) {
        const lastHunk = hunks[hunks.length - 1];
        if (lastHunk) {
          lastHunk.content = file.patch.slice(lastIndex);
        }
      }

      for (const hunk of hunks) {
        let oldLine = hunk.oldStart;
        let newLine = hunk.newStart;

        const lines = hunk.content.split("\n");
        for (const line of lines) {
          if (line === "" && lines.indexOf(line) === 0) continue; // skip leading empty line after @@
          if (line.startsWith("-")) {
            leftLines.add(oldLine);
            oldLine++;
          } else if (line.startsWith("+")) {
            rightLines.add(newLine);
            newLine++;
          } else if (line.startsWith(" ") || line === "") {
            // context line
            leftLines.add(oldLine);
            rightLines.add(newLine);
            oldLine++;
            newLine++;
          } else if (line.startsWith("\\")) {
            // \ No newline at end of file
          }
        }
      }

      this.lines.set(file.filename, { RIGHT: rightLines, LEFT: leftLines });
    }
  }

  public hasLine(path: string, line: number, side: "RIGHT" | "LEFT"): boolean {
    const fileLines = this.lines.get(path);
    if (!fileLines) return false;
    return fileLines[side].has(line);
  }
}

export function mapFinding(finding: FindingInput, commentableSet: CommentableSet): MappedFinding {
  if (!finding.locationHint) {
    return { kind: "demoted", reason: "No locationHint provided" };
  }

  // Parse path:line or path:startLine-endLine
  const match = finding.locationHint.match(/^(.+?):(\d+)(?:-(\d+))?$/);
  if (!match) {
    return { kind: "demoted", reason: `locationHint '${finding.locationHint}' is malformed` };
  }

  const path = match[1] as string;
  const line1 = Number.parseInt(match[2] as string, 10);
  const line2 = match[3] ? Number.parseInt(match[3] as string, 10) : undefined;

  // We map multiline comments if both lines are within hunks
  let start_line: number | undefined;
  let line: number;

  if (line2 !== undefined) {
    start_line = line1;
    line = line2;
  } else {
    line = line1;
  }

  // Ensure lines are properly ordered
  if (start_line !== undefined && start_line > line) {
    return { kind: "demoted", reason: `Start line ${start_line} is greater than end line ${line}` };
  }

  // Heuristic: prioritize RIGHT side because agents usually search the new code
  const endSide = commentableSet.hasLine(path, line, "RIGHT")
    ? "RIGHT"
    : commentableSet.hasLine(path, line, "LEFT")
      ? "LEFT"
      : undefined;

  if (!endSide) {
    return { kind: "demoted", reason: `Line ${line} in ${path} is outside the patch hunks` };
  }

  let startSide: "RIGHT" | "LEFT" | undefined = undefined;
  if (start_line !== undefined) {
    startSide = commentableSet.hasLine(path, start_line, "RIGHT")
      ? "RIGHT"
      : commentableSet.hasLine(path, start_line, "LEFT")
        ? "LEFT"
        : undefined;
    if (!startSide) {
      return {
        kind: "demoted",
        reason: `Start line ${start_line} in ${path} is outside the patch hunks`,
      };
    }
    // GitHub API requires start_line and line to be on the same side
    if (startSide !== endSide) {
      return {
        kind: "demoted",
        reason: `Start line ${start_line} and end line ${line} are on different sides of the diff`,
      };
    }
  }

  return {
    kind: "inline",
    path,
    line,
    side: endSide as "RIGHT" | "LEFT",
    start_line: start_line !== line ? start_line : undefined,
    start_side: (start_line !== undefined && start_line !== line ? startSide : undefined) as
      | "RIGHT"
      | "LEFT"
      | undefined,
  };
}
