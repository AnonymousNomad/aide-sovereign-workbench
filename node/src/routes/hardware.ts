import { type Route, RouteError } from '../server.ts';
import { createRequire } from 'node:module';
import { HardwareProfileResponse, HardwareRecommendResponse } from '../../../common/contracts/hardware.ts';

const require = createRequire(import.meta.url);
const { getDeviceProfile, recommendRoles } = require('../services/hardware-profile.mjs');

function wrap(handler: () => Promise<unknown>): () => Promise<unknown> {
  return async () => {
    try {
      return await handler();
    } catch (error) {
      if (error instanceof RouteError) throw error;
      throw new RouteError(
        'CHILD_FAILED',
        error instanceof Error ? error.message : 'hardware probe failed'
      );
    }
  };
}

export function routesForHardware(): Route[] {
  return [
    {
      method: 'GET',
      path: '/api/hardware/profile',
      response: HardwareProfileResponse,
      handler: wrap(async () => getDeviceProfile())
    },
    {
      method: 'GET',
      path: '/api/hardware/recommend',
      response: HardwareRecommendResponse,
      handler: wrap(async () => recommendRoles())
    }
  ];
}