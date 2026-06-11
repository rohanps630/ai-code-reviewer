export interface FileResult {
  found: boolean;
  language?: string | null;
  content?: string;
  chunk_count?: number;
}

export interface ReferenceResult {
  path: string;
  start_line: number;
  end_line: number;
  symbol_name: string | null;
  symbol_kind: string | null;
  content: string;
}

export interface CodeSource {
  readFile(path: string, repoId?: string): Promise<FileResult>;
  findReferences(symbol: string, limit: number, repoId?: string): Promise<ReferenceResult[]>;
}
