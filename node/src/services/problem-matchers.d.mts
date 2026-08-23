export declare class MatcherError extends Error {
  constructor(message: string, detail?: unknown);
  name: 'MATCHER';
  detail?: unknown;
}

export interface ProblemPatternDef {
  regexp: string;
  file?: number;
  line?: number;
  column?: number;
  severity?: number;
  code?: number;
  message?: number;
  kind?: 'file' | 'location';
  loop?: boolean;
}

export interface ProblemMatcherDef {
  name: string;
  owner: string;
  source?: string;
  applyTo?: 'allDocuments' | 'openDocuments';
  pattern: ProblemPatternDef | ProblemPatternDef[];
  fileLocation?: 'relative' | 'absolute' | ['relative', string];
  background?: { activeOnStart: boolean; beginsPattern: string; endsPattern: string };
}

export declare const BUILTIN_MATCHERS: Record<string, ProblemMatcherDef>;

export declare function normalizeProblemMatcher(value: unknown): ProblemMatcherDef;

export declare function resolveProblemMatcher(
  reference: unknown,
  extraMatchers?: Record<string, ProblemMatcherDef>
): ProblemMatcherDef;
