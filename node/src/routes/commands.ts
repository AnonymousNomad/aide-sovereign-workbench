import { RouteError, type Route } from '../server.ts';
import {
  CommandInvokeRequest,
  CommandInvokeResponse,
  CommandListResponse,
  KeybindingListResponse,
  KeybindingResolveRequest,
  KeybindingResolveResponse,
  SettingsGetResponse,
  SettingsPutRequest,
  SettingsPutResponse,
  type CommandInvokeRequestT,
  type CommandInvokeResponseT,
  type CommandListResponseT,
  type KeybindingListResponseT,
  type KeybindingResolveRequestT,
  type KeybindingResolveResponseT,
  type SettingsGetResponseT,
  type SettingsPutRequestT,
  type SettingsPutResponseT
} from '../../../common/contracts/commands.ts';
import type { CommandRegistry } from '../../../node/src/services/command-registry.mjs';
import type { KeybindingService } from '../../../node/src/services/keybinding-service.mjs';
import type { SettingsService } from '../../../node/src/services/settings-service.mjs';

export function routeForCommandList(registry: CommandRegistry): Route {
  return {
    method: 'GET',
    path: '/api/commands',
    response: CommandListResponse,
    handler: (): CommandListResponseT => ({ commands: registry.list() })
  };
}

export function routeForCommandInvoke(registry: CommandRegistry): Route {
  return {
    method: 'POST',
    path: '/api/commands/invoke',
    body: CommandInvokeRequest,
    response: CommandInvokeResponse,
    handler: async ({ body }): Promise<CommandInvokeResponseT> => {
      const input = body as unknown as CommandInvokeRequestT;
      const result = await registry.invoke(input.id, input.args, {});
      if (result.error === 'NOT_FOUND') throw new RouteError('NOT_FOUND', result.message ?? 'unknown command');
      if (result.error === 'FORBIDDEN') throw new RouteError('FORBIDDEN', result.message ?? 'command disabled');
      if (result.error) throw new RouteError('BAD_REQUEST', result.message ?? 'command failed');
      return { result: (result.result ?? null) as unknown };
    }
  };
}

export function routeForKeybindingList(service: KeybindingService): Route {
  return {
    method: 'GET',
    path: '/api/keybindings',
    response: KeybindingListResponse,
    handler: (): KeybindingListResponseT => ({ rules: service.list() })
  };
}

export function routeForKeybindingResolve(service: KeybindingService): Route {
  return {
    method: 'POST',
    path: '/api/keybindings/resolve',
    body: KeybindingResolveRequest,
    response: KeybindingResolveResponse,
    handler: ({ body }): KeybindingResolveResponseT => service.resolve((body as unknown as KeybindingResolveRequestT).chords, {})
  };
}

export function routeForSettingsGet(service: SettingsService): Route {
  return {
    method: 'GET',
    path: '/api/settings',
    response: SettingsGetResponse,
    handler: (): SettingsGetResponseT => ({ values: service.merged(), descriptors: service.descriptors() })
  };
}

export function routeForSettingsPut(service: SettingsService): Route {
  return {
    method: 'PUT',
    path: '/api/settings',
    body: SettingsPutRequest,
    response: SettingsPutResponse,
    handler: async ({ body }): Promise<SettingsPutResponseT> => {
      try {
        return { values: await service.writeUserValues((body as unknown as SettingsPutRequestT).values) };
      } catch (error) {
        throw new RouteError('BAD_REQUEST', String((error as Error).message));
      }
    }
  };
}
