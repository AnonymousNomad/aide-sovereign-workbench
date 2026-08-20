import { z } from 'zod';

export const DapAdapterState = z.enum(['available', 'starting', 'running', 'error', 'stopped', 'not_found']);

export const DapAdapterEntry = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    languages: z.array(z.string().min(1)),
    status: DapAdapterState,
    capabilities: z.record(z.string(), z.boolean())
  })
  .strict();

export const DapStatusResponse = z
  .object({
    adapters: z.array(DapAdapterEntry)
  })
  .strict();

export const DapAdapterRequest = z
  .object({
    adapterId: z.string().min(1)
  })
  .strict();

export const DapStartResponse = z
  .object({
    adapterId: z.string().min(1),
    status: DapAdapterState
  })
  .strict();

export const DapLaunchRequest = z
  .object({
    adapterId: z.string().min(1),
    program: z.string().min(1),
    args: z.array(z.string()).optional(),
    cwd: z.string().min(1).optional()
  })
  .strict();

export const DapLaunchResponse = z
  .object({
    launched: z.boolean()
  })
  .strict();

export const DapBreakpointsRequest = z
  .object({
    adapterId: z.string().min(1),
    path: z.string().min(1),
    lines: z.array(z.number().int().positive()).min(1)
  })
  .strict();

export const DapBreakpointEntry = z
  .object({
    line: z.number().int().positive(),
    verified: z.boolean(),
    message: z.string().optional()
  })
  .strict();

export const DapBreakpointsResponse = z
  .object({
    breakpoints: z.array(DapBreakpointEntry)
  })
  .strict();

export const DapConfigureResponse = z
  .object({
    configured: z.boolean()
  })
  .strict();

export const DapThreadRequest = z
  .object({
    adapterId: z.string().min(1),
    threadId: z.number().int().nonnegative()
  })
  .strict();

export const DapContinueResponse = z
  .object({
    continuing: z.boolean()
  })
  .strict();

export const DapStepRequest = DapThreadRequest.extend({
  kind: z.enum(['next', 'stepIn', 'stepOut'])
});

export const DapStepResponse = z
  .object({
    stepping: z.boolean()
  })
  .strict();

export const DapStackRequest = DapThreadRequest;

export const DapStackFrame = z
  .object({
    id: z.number().int().nonnegative(),
    name: z.string().min(1),
    line: z.number().int().positive(),
    path: z.string().optional()
  })
  .strict();

export const DapStackResponse = z
  .object({
    frames: z.array(DapStackFrame)
  })
  .strict();

export const DapScopesRequest = z
  .object({
    adapterId: z.string().min(1),
    frameId: z.number().int().nonnegative()
  })
  .strict();

export const DapScopeEntry = z
  .object({
    name: z.string().min(1),
    variablesReference: z.number().int().nonnegative()
  })
  .strict();

export const DapScopesResponse = z
  .object({
    scopes: z.array(DapScopeEntry)
  })
  .strict();

export const DapVariablesRequest = z
  .object({
    adapterId: z.string().min(1),
    variablesReference: z.number().int().nonnegative()
  })
  .strict();

export const DapVariableEntry = z
  .object({
    name: z.string(),
    value: z.string(),
    variablesReference: z.number().int().nonnegative().optional()
  })
  .strict();

export const DapVariablesResponse = z
  .object({
    variables: z.array(DapVariableEntry)
  })
  .strict();

export const DapDisconnectResponse = z
  .object({
    disconnected: z.boolean()
  })
  .strict();

export const DapEvent = z
  .object({
    adapterId: z.string().min(1),
    event: z.string().min(1),
    body: z.unknown()
  })
  .strict();

export type DapAdapterStateT = z.infer<typeof DapAdapterState>;
export type DapAdapterEntryT = z.infer<typeof DapAdapterEntry>;
export type DapStatusResponseT = z.infer<typeof DapStatusResponse>;
export type DapLaunchRequestT = z.infer<typeof DapLaunchRequest>;
export type DapBreakpointEntryT = z.infer<typeof DapBreakpointEntry>;
export type DapStackFrameT = z.infer<typeof DapStackFrame>;
export type DapScopeEntryT = z.infer<typeof DapScopeEntry>;
export type DapVariableEntryT = z.infer<typeof DapVariableEntry>;
export type DapEventT = z.infer<typeof DapEvent>;