import { z } from 'zod';

export const DesktopGrants = z
  .object({
    apps: z.array(z.string().min(1)).max(32),
    roots: z.array(z.string().min(2)).max(16),
    window_titles: z.array(z.string().min(1)).max(32)
  })
  .strict();

export const DesktopGrantsManifest = z
  .object({
    version: z.literal(1),
    enabled: z.boolean(),
    grants: DesktopGrants,
    session_started_at: z.string(),
    ttl_minutes: z.number().int().positive().max(720),
    approved_by: z.literal('operator-wizard')
  })
  .strict();

export const DesktopActionRequest = z
  .object({
    op: z.enum(['launch_app', 'open_path', 'list_windows', 'focus_window', 'move_file']),
    target: z.string().max(500).optional(),
    destination: z.string().max(500).optional(),
    approved: z.boolean()
  })
  .strict();

export const DesktopActionResult = z
  .object({
    ok: z.boolean(),
    decision: z.enum(['executed', 'refused', 'expired', 'panic']),
    reason: z.string().optional(),
    output: z.string().optional(),
    latency_ms: z.number().int().nonnegative()
  })
  .strict();

export const PanicResult = z
  .object({
    ok: z.boolean(),
    children_killed: z.number().int().nonnegative(),
    revoked_at: z.string(),
    latency_ms: z.number().int().nonnegative()
  })
  .strict();

export const DesktopStatusResponse = z
  .object({
    enabled: z.boolean(),
    ttl_minutes: z.number().int().positive().nullable(),
    session_started_at: z.string().nullable(),
    grants: DesktopGrants,
    tracked_children: z.number().int().nonnegative(),
    panicked: z.boolean()
  })
  .strict();

export const DesktopGrantsSetResponse = DesktopStatusResponse;

export type DesktopActionRequestT = z.infer<typeof DesktopActionRequest>;
