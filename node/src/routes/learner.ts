import path from 'node:path';
import { RouteError, type Route } from '../server.ts';
import type { OperationInput } from '../../../common/security/operation-policy.mjs';
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

// The attempt mutates derived learner state (mastery/streak/due) that is a
// deterministic subordinate effect of the exact approved attempt: no egress,
// no model execution, no unrelated targets. The learner state file anchors the
// workspace and fails closed if the production layout is absent.
function workspaceOf(state: LearnerState): string {
  const statePath = (state as unknown as { statePath?: unknown }).statePath;
  if (typeof statePath !== 'string') throw new RouteError('FORBIDDEN', 'workspace anchor unavailable');
  const aideDir = path.dirname(statePath);
  if (path.basename(aideDir) !== '.aide') throw new RouteError('FORBIDDEN', 'workspace anchor unavailable');
  return path.dirname(aideDir);
}

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
    describeOperation: async ({ body }, taskId): Promise<OperationInput> => {
      const input = body as LearnerAttemptRequestT;
      return {
        workspace: workspaceOf(state),
        taskId,
        kind: 'capability.write',
        args: {
          body: {
            skill_id: input.skill_id,
            passed: input.passed,
            ...(input.misconception_tags ? { misconception_tags: input.misconception_tags } : {})
          }
        }
      };
    },
    handler: async ({ body }): Promise<LearnerAttemptResponseT> => {
      const input = body as LearnerAttemptRequestT;
      return state.recordAttempt(input.skill_id, {
        passed: input.passed,
        ...(input.misconception_tags ? { misconceptionTags: input.misconception_tags } : {})
      });
    }
  };
}
