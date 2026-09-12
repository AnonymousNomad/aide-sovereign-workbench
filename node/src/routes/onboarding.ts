// node/src/routes/onboarding.ts (cline/T4, 2026-09-02)
//
// PR A of aide-onboarding-walkthrough. 4 routes: state get/put + next + complete.
// Pattern matches workbenches.ts (the worktree routes are in there).
//
// Authority binding: next/complete descriptors bind the origin step (and the
// completion flag) that the operator approves. The handler retrieves those
// exact approved values from the execution authority and passes them into the
// service, whose per-service critical section re-reads durable state, compares
// it against the approved precondition, and only then performs the durable
// transition. A post-approval state change therefore fails CONFLICT before any
// mutation instead of executing a transition the operator never approved.

import { RouteError, type Route, type RouteContext } from '../server.ts';
import type { OperationInput } from '../../../common/security/operation-policy.mjs';
import {
  OnboardingState,
  OnboardingStateResponse,
  OnboardingNextResponse,
  OnboardingCompleteResponse,
  OnboardingUserChoices,
  type OnboardingStateT,
  type OnboardingUserChoicesT
} from '../../../common/contracts/onboarding.ts';
import { createOnboardingService, OnboardingConflictError } from '../services/onboarding.mjs';

// Onboarding mutations are state transitions, not generic writes. Transitions
// bind the origin step (and completion flag) resolved before approval, so
// approval for one transition cannot execute a different one after the state
// has moved.
function transitionOperation(workspace: string, taskId: string, body: Record<string, unknown>): OperationInput {
  return { workspace, taskId, kind: 'capability.write', args: { body } };
}

// The exact normalized body of the operation ExecutionAuthority approved. It is
// read from the authority's own immutable operation record via the execution
// handle the server placed on the route context; it is never re-derived from a
// fresh state read.
function approvedTransitionBody(context: RouteContext): Record<string, unknown> {
  const { authority, actor, execution } = context;
  if (!authority || !actor || !execution) throw new RouteError('FORBIDDEN', 'trusted execution context required');
  const operation = authority.inspect(actor, execution.operation_id);
  const body = (operation.args as { body?: unknown } | undefined)?.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new RouteError('CONFLICT', 'approved transition binding unavailable');
  }
  return body as Record<string, unknown>;
}

function rethrowTransitionError(error: unknown): never {
  if (error instanceof OnboardingConflictError) throw new RouteError('CONFLICT', error.message);
  throw error;
}

export function routesForOnboarding(workspace: string): Route[] {
  const svc = createOnboardingService({ workspace });
  return [
    { method: "GET", path: "/api/onboarding/state", response: OnboardingStateResponse, handler: async () => {
      const state = await svc.getState();
      return { state };
    } },
    { method: "PUT", path: "/api/onboarding/state", body: OnboardingState, response: OnboardingStateResponse, describeOperation: async ({ body }, taskId): Promise<OperationInput> => {
      return transitionOperation(workspace, taskId, { state: body as Record<string, unknown> });
    }, handler: async ({ body }) => {
      const state = await svc.setState(body);
      return { state };
    } },
    { method: "POST", path: "/api/onboarding/next", body: OnboardingUserChoices.partial(), response: OnboardingNextResponse, describeOperation: async ({ body }, taskId): Promise<OperationInput> => {
      const current = await svc.getState();
      return transitionOperation(workspace, taskId, { partial: body as Record<string, unknown>, from_step: current.current_step });
    }, handler: async (context) => {
      const approved = approvedTransitionBody(context);
      try {
        return await svc.nextStep(context.body as Partial<OnboardingUserChoicesT>, { from_step: approved.from_step as OnboardingStateT['current_step'] });
      } catch (error) {
        rethrowTransitionError(error);
      }
    } },
    { method: "POST", path: "/api/onboarding/complete", response: OnboardingCompleteResponse, describeOperation: async (_ctx, taskId): Promise<OperationInput> => {
      const current = await svc.getState();
      return transitionOperation(workspace, taskId, { from_step: current.current_step, walkthrough_complete: current.walkthrough_complete });
    }, handler: async (context) => {
      const approved = approvedTransitionBody(context);
      try {
        const state = await svc.complete({
          from_step: approved.from_step as OnboardingStateT['current_step'],
          walkthrough_complete: approved.walkthrough_complete === true
        });
        return { state, complete: true };
      } catch (error) {
        rethrowTransitionError(error);
      }
    } }
  ];
}
