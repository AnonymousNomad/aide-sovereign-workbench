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

export declare interface OnboardingService {
  getState(): Promise<OnboardingStateT>;
  setState(next: OnboardingStateT): Promise<OnboardingStateT>;
  nextStep(partial?: Partial<OnboardingUserChoicesT>): Promise<OnboardingNextResponseT>;
  skipStep(partial?: Partial<OnboardingUserChoicesT>): Promise<OnboardingStateT>;
  complete(): Promise<OnboardingStateT>;
}

export declare function createOnboardingService(options: { workspace: string }): OnboardingService;