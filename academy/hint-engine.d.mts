export interface HintLadderEntry {
  level: number;
  text: string;
  remaining: number;
}

export interface HintExhausted {
  exhausted: true;
  revealed: number;
}

export declare function checkPayloadTokens(check?: string | null): string[];
export declare function leaksAnswer(text: unknown, lesson?: { check?: string } | null): boolean;
export declare function buildLadder(lesson: { id?: string; title?: string; kind?: string; objective?: string; check?: string } | null): string[];
export declare function nextHint(
  lesson: { id?: string; title?: string; kind?: string; objective?: string; check?: string } | null,
  afterLevel?: number
): HintLadderEntry | HintExhausted;
