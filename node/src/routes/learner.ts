import type { Route } from '../server.ts';
import {
  LearnerAttemptRequest,
  LearnerAttemptResponse,
  LearnerReviewsResponse,
  LearnerSnapshotResponse,
  type LearnerAttemptRequestT,
  type LearnerAttemptResponseT,
  type LearnerReviewsResponseT,
  type LearnerSnapshotResponseT
} from '../../../common/contracts/learner.ts';
import type { LearnerState } from '../../../academy/learner-state.mjs';

export function routeForLearnerState(state: LearnerState): Route {
  return {
    method: 'GET',
    path: '/api/learner/state',
    response: LearnerSnapshotResponse,
    handler: (): LearnerSnapshotResponseT => state.snapshot()
  };
}

export function routeForLearnerReviews(state: LearnerState): Route {
  return {
    method: 'GET',
    path: '/api/learner/reviews',
    response: LearnerReviewsResponse,
    handler: (): LearnerReviewsResponseT => ({ reviews: state.dueReviews() })
  };
}

export function routeForLearnerAttempt(state: LearnerState): Route {
  return {
    method: 'POST',
    path: '/api/learner/attempt',
    body: LearnerAttemptRequest,
    response: LearnerAttemptResponse,
    handler: async ({ body }): Promise<LearnerAttemptResponseT> => {
      const input = body as LearnerAttemptRequestT;
      return state.recordAttempt(input.skill_id, {
        passed: input.passed,
        ...(input.misconception_tags ? { misconceptionTags: input.misconception_tags } : {})
      });
    }
  };
}
