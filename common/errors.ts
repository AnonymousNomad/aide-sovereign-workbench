import { z } from 'zod';

export const ERROR_CODES = [
  'BAD_REQUEST',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'INTERNAL',
  'NOT_READY',
  'TIMEOUT',
  'CHILD_FAILED',
  'BAD_RESPONSE',
  'COMMIT_FAILED'
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ErrorDetail = z.unknown();

export const EnvelopeOk = z
  .object({ ok: z.literal(true), data: z.unknown() })
  .strict();

export const EnvelopeError = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: z.enum(ERROR_CODES),
        message: z.string(),
        detail: ErrorDetail.optional()
      })
      .strict()
  })
  .strict();

export const Envelope = z.union([EnvelopeOk, EnvelopeError]);

export type EnvelopeOkT = z.infer<typeof EnvelopeOk>;
export type EnvelopeErrorT = z.infer<typeof EnvelopeError>;
export type EnvelopeT = z.infer<typeof Envelope>;

export function ok<T>(data: T): EnvelopeOkT {
  return { ok: true, data };
}

export function fail(code: ErrorCode, message: string, detail?: unknown): EnvelopeErrorT {
  const body: { code: ErrorCode; message: string; detail?: unknown } = { code, message };
  if (detail !== undefined) body.detail = detail;
  return { ok: false, error: body };
}