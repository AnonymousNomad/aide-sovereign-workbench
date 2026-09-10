import { z } from 'zod';

export const SESSION_VERSION = 1;

export const SessionTab = z
  .object({
    uri: z.string().min(1),
    splitId: z.string().min(1).optional(),
    dirty: z.boolean().optional(),
    viewState: z.unknown().optional()
  })
  .strict();

export type SessionTabT = z.infer<typeof SessionTab>;

// Legacy cockpit keys are carried through the envelope README.md parity for the
// "frictionless handoff from the original AIDE" requirement: files written by
// the original editor (active_file/open_files/buffers/panel/selected_engine_id)
// round-trip through the canonical TS store, so restoring the last engine and
// hot-exit recovery keep working with zero frontend changes. Anything unknown
// is still rejected (strict).
const LEGACY_SESSION_KEYS = {
  active_file: z.string().min(1).max(500),
  open_files: z.array(z.string().min(1).max(500)).max(200),
  buffers: z.record(z.string().min(1).max(1024), z.string().max(524288)),
  panel: z.string().max(100),
  selected_engine_id: z.string().min(1).max(200)
};

export const SessionFile = z
  .object({
    version: z.literal(SESSION_VERSION),
    activeTab: z.string().min(1).optional(),
    tabs: z.array(SessionTab).max(200).default([]),
    splits: z.array(z.string().min(1)).max(8).optional(),
    active_file: LEGACY_SESSION_KEYS.active_file.optional(),
    open_files: LEGACY_SESSION_KEYS.open_files.optional(),
    buffers: z.record(z.string().min(1).max(1024), z.string().max(524288)).optional(),
    panel: LEGACY_SESSION_KEYS.panel.optional(),
    selected_engine_id: LEGACY_SESSION_KEYS.selected_engine_id.optional()
  })
  .strict();

export type SessionFileT = z.infer<typeof SessionFile>;

export const SessionGetResponse = SessionFile;

// PUT accepts a loose patch: canonical full writes ({version, tabs, ...}) OR
// partial legacy-shaped writes ({selected_engine_id}, hot-exit
// {open_files, buffers, selected_engine_id}, first-AIDE {active_file, panel}).
// Unknown keys are still rejected. version is optional; the store merges the
// patch over the current state and persists a canonical SessionFile.
export const SessionPutRequest = z
  .object({
    version: z.literal(SESSION_VERSION).optional(),
    activeTab: z.string().min(1).optional(),
    tabs: z.array(SessionTab).max(200).optional(),
    splits: z.array(z.string().min(1)).max(8).optional(),
    active_file: LEGACY_SESSION_KEYS.active_file.optional(),
    open_files: LEGACY_SESSION_KEYS.open_files.optional(),
    buffers: z.record(z.string().min(1).max(1024), z.string().max(524288)).optional(),
    panel: LEGACY_SESSION_KEYS.panel.optional(),
    selected_engine_id: LEGACY_SESSION_KEYS.selected_engine_id.optional()
  })
  .strict();

export type SessionPutRequestT = z.infer<typeof SessionPutRequest>;

export const SessionPutResponse = SessionFile;