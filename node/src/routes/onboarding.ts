// node/src/routes/onboarding.ts (cline/T4, 2026-09-02)
//
// PR A of aide-onboarding-walkthrough. 4 routes: state get/put + next + complete.
// Pattern matches workbenches.ts (the worktree routes are in there).

import { type Route, type RouteContext } from '../server.ts';
import {
  OnboardingState,
  OnboardingStateResponse,
  OnboardingNextResponse,
  OnboardingCompleteResponse,
  OnboardingUserChoices,
  type OnboardingStateT,
  type OnboardingUserChoicesT,
  type OnboardingNextResponseT
} from '../../../common/contracts/onboarding.ts';
import { createOnboardingService } from '../services/onboarding.mjs';

export function routesForOnboarding(workspace: string): Route[] {
  const svc = createOnboardingService({ workspace });
  return [
    { method: "GET", path: "/api/onboarding/state", response: OnboardingStateResponse, handler: async () => {
      const state = await svc.getState();
      return { state };
    } },
    { method: "PUT", path: "/api/onboarding/state", body: OnboardingState, response: OnboardingStateResponse, handler: async ({ body }: RouteContext) => {
      const state = await svc.setState(body as OnboardingStateT);
      return { state };
    } },
    { method: "POST", path: "/api/onboarding/next", body: OnboardingUserChoices.partial(), response: OnboardingNextResponse, handler: async ({ body }: RouteContext) => {
      const result = await svc.nextStep(body as Partial<OnboardingUserChoicesT>) as OnboardingNextResponseT;
      return result;
    } },
    { method: "POST", path: "/api/onboarding/complete", response: OnboardingCompleteResponse, handler: async () => {
      const state = await svc.complete();
      return { state, complete: true };
    } }
  ];
}
