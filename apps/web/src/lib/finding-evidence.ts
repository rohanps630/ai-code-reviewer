import type { Finding, ReviewChunk } from "@acr/agent";
import { z } from "zod";

export type EvidenceReason = "exact_line_match" | "partial_line_overlap" | "file_match";

export type EvidenceItem = {
  toolEventIndex: number;
  toolName: string;
  path: string;
  startLine?: number;
  endLine?: number;
  snippet?: string;
  reason: EvidenceReason;
};

const HitSchema = z.object({
  path: z.string(),
  start_line: z.number().int().nonnegative(),
  end_line: z.number().int().nonnegative(),
  content_with_context: z.string().optional(),
});

const SearchCodeOutputSchema = z.object({
  hits: z.array(HitSchema).optional(),
});

const ReadFileOutputSchema = z.object({
  found: z.boolean(),
  path: z.string().optional(),
  content: z.string().optional(),
});

const ReferenceSchema = z.object({
  path: z.string(),
  start_line: z.number().int().nonnegative(),
  end_line: z.number().int().nonnegative(),
  snippet: z.string().optional(),
});

const FindReferencesOutputSchema = z.object({
  references: z.array(ReferenceSchema).optional(),
});

type EvidenceCandidate = {
  toolEventIndex: number;
  toolName: string;
  path: string;
  startLine?: number;
  endLine?: number;
  snippet?: string;
};

export function parseLocationHint(
  hint: string | undefined,
): { path: string; startLine?: number; endLine?: number } | null {
  if (!hint) return null;
  const match = hint.match(/^([^:]+)(?::(\d+)(?:-(\d+))?)?$/);
  if (!match) return { path: hint };

  const path = match[1] as string;
  const startLine = match[2] ? Number.parseInt(match[2], 10) : undefined;
  const endLine = match[3] ? Number.parseInt(match[3], 10) : startLine;

  return { path, startLine, endLine };
}

function parseCandidates(chunks: ReviewChunk[]): EvidenceCandidate[] {
  const candidates: EvidenceCandidate[] = [];
  let toolEventIndex = 0;

  for (const chunk of chunks) {
    if (chunk.type === "tool_call" || chunk.type === "tool_result") {
      const currentIndex = toolEventIndex++;
      if (chunk.type === "tool_result") {
        if (chunk.name === "search_code") {
          const parsed = SearchCodeOutputSchema.safeParse(chunk.output);
          if (parsed.success && parsed.data.hits) {
            for (const hit of parsed.data.hits) {
              candidates.push({
                toolEventIndex: currentIndex,
                toolName: chunk.name,
                path: hit.path,
                startLine: hit.start_line,
                endLine: hit.end_line,
                snippet: hit.content_with_context,
              });
            }
          }
        } else if (chunk.name === "read_file") {
          const parsed = ReadFileOutputSchema.safeParse(chunk.output);
          if (parsed.success && parsed.data.found && parsed.data.path) {
            candidates.push({
              toolEventIndex: currentIndex,
              toolName: chunk.name,
              path: parsed.data.path,
              // No lines means whole file
            });
          }
        } else if (chunk.name === "find_references") {
          const parsed = FindReferencesOutputSchema.safeParse(chunk.output);
          if (parsed.success && parsed.data.references) {
            for (const ref of parsed.data.references) {
              candidates.push({
                toolEventIndex: currentIndex,
                toolName: chunk.name,
                path: ref.path,
                startLine: ref.start_line,
                endLine: ref.end_line,
                snippet: ref.snippet,
              });
            }
          }
        }
      }
    }
  }

  return candidates;
}

/**
 * Correlates findings with the agent's tool execution events to surface evidence.
 *
 * This is a pure heuristic function that runs on replay or finalization. It parses
 * the untrusted JSON payloads from `agent_events` and matches them against finding
 * location hints.
 */
export function correlateEvidence(findings: Finding[], chunks: ReviewChunk[]): EvidenceItem[][] {
  const candidates = parseCandidates(chunks);

  return findings.map((finding) => {
    const hint = parseLocationHint(finding.locationHint);
    if (!hint) return [];

    const evidence: EvidenceItem[] = [];

    for (const candidate of candidates) {
      if (candidate.path !== hint.path) continue;

      let reason: EvidenceReason | null = null;

      if (hint.startLine !== undefined && hint.endLine !== undefined) {
        if (candidate.startLine !== undefined && candidate.endLine !== undefined) {
          // Check for line overlap
          if (candidate.startLine <= hint.endLine && candidate.endLine >= hint.startLine) {
            if (candidate.startLine === hint.startLine && candidate.endLine === hint.endLine) {
              reason = "exact_line_match";
            } else {
              reason = "partial_line_overlap";
            }
          }
        } else {
          // Candidate is a whole file, so it covers the lines
          reason = "file_match";
        }
      } else {
        // Finding has no lines, so any candidate in the file matches
        reason = "file_match";
      }

      if (reason) {
        evidence.push({ ...candidate, reason });
      }
    }

    // Rank: exact > partial > file match
    evidence.sort((a, b) => {
      const rank = { exact_line_match: 1, partial_line_overlap: 2, file_match: 3 };
      return rank[a.reason] - rank[b.reason];
    });

    return evidence;
  });
}
