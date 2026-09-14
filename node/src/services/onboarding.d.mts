// node/src/services/onboarding.d.mts
//
// Type companion for onboarding.mjs. The .mjs service is a real
// implementation (atomic JSON persistence under <workspace>/.aide/);
// this file declares its shape to TypeScript so .ts importers
// (e.g. node/src/routes/onboarding.ts) can use it without `any`.
//
// Pattern: mirror the export surface 1:1 (see worktree.d.mts).
import type {
  OnboardingStateT,
  OnboardingNextResponseT,
  OnboardingUserChoicesT
} from '../../common/contracts/onboarding.ts';

export declare class OnboardingConflictError extends Error {
  constructor(message?: string);
  name: 'ONBOARDING_CONFLICT';
}

export declare interface OnboardingExpectedState {
  from_step?: OnboardingStateT['current_step'];
  walkthrough_complete?: boolean;
}

export declare interface OnboardingService {
  getState(): Promise<OnboardingStateT>;
  setState(next: OnboardingStateT): Promise<OnboardingStateT>;
  nextStep(partial?: Partial<OnboardingUserChoicesT>, expected?: OnboardingExpectedState): Promise<OnboardingNextResponseT>;
  skipStep(partial?: Partial<OnboardingUserChoicesT>, expected?: OnboardingExpectedState): Promise<OnboardingStateT>;
  complete(expected?: OnboardingExpectedState): Promise<OnboardingStateT>;
}

export declare function createOnboardingService(options: { workspace: string }): OnboardingService;