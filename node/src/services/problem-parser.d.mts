import type { ProblemMatcherDef } from './problem-matchers.d.mts';

export interface RawProblem {
  file: string;
  line: number;
  column: number | null;
  severity: 'error' | 'warning' | 'info';
  message: string;
  code: string | null;
}

export interface ResolvedProblem extends RawProblem {
  file: string;
}

export interface ParseResult {
  problems: ResolvedProblem[];
  dropped: number;
}

export declare class MatcherSession {
  constructor(matcher: ProblemMatcherDef);
  push(line: string): RawProblem[];
}

export declare function extractRawProblems(matcher: ProblemMatcherDef, text: string): RawProblem[];

export declare function parseProblems(
  matcher: ProblemMatcherDef,
  text: string,
  options: { workspaceRoot: string; cwd?: string }
): ParseResult;
