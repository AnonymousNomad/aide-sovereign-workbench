import type {
  OnboardingStateT,
  OnboardingUserChoicesT,
  OnboardingNextResponseT
} from '../../../common/contracts/onboarding.ts';

export interface OnboardingService {
  getState(): Promise<OnboardingStateT>;
  setState(next: OnboardingStateT): Promise<OnboardingStateT>;
  nextStep(partial: Partial<OnboardingUserChoicesT>): Promise<OnboardingNextResponseT>;
  skipStep(partial: Partial<OnboardingUserChoicesT>): Promise<OnboardingStateT>;
  complete(): Promise<OnboardingStateT>;
}

export declare function createOnboardingService(options: { workspace: string }): OnboardingService;
